const { DatabaseService } = require('@cap-js/db-service')
const cds = require('@sap/cds/lib')

class EdgeService extends DatabaseService {
  async init() {
    this.services = await Promise.all(this.options.databases.map(n => cds.connect.to(n)))
    // Read events from the edge database
    this.on(['SELECT', 'STREAM'], this.onEDGE)
    // Apply events to active databases of the transaction
    this.on(['BEGIN', 'COMMIT', 'ROLLBACK'], this.onEVENT)
    // Write events to all databases
    this.on(['*'], this.onALL)
    return super.init()
  }

  get factory() {
    return {
      options: { max: 1, ...this.options.pool },
      create: tenant => {
        return Promise.all(this.services.map(s => s.tx({ tenant })))
      },
      destroy: () => {},
      validate: () => {},
    }
  }

  /**
   * Synchronizes the edge database with the next database in the list
   * This should be done on a regular basis to keep the edge database up to date
   * While the edge database is up to date in a single instance scenario
   * It will be out of sync in a multi instance scenario
   * When routing all related requests to the same instance this is not a problem
   * Preferably using features like tenant based routing and http2/3 long living connections
   * Additionally it is possible to only store already requested data in the edge database
   * This would require onEDGE to properly failover to the next database
   */
  async sync() {
    const orgInit = cds.deploy.init
    try {
      cds.deploy.init = () => {}
      await cds.deploy(cds.options.from[0]).to(this.services[0])
    } finally {
      cds.deploy.init = orgInit
    }

    // TODO: draft tables -_-'
    const tables = Object.keys(this.model.definitions).filter(n => {
      const def = this.model.definitions[n]
      return def.kind === 'entity' && !def.query
    })

    // Pulls all tables from database 1 into database 0 (edge)
    await Promise.all(
      tables.map(async t => {
        // TODO: replace with dataset streaming when merged for all databases
        return this.services[0].run(INSERT(await this.services[1].run(SELECT.from(t))).into(t))
      }),
    )
  }

  url4(tenant) {
    return `edge:\n${this.services.map(s => `${s.name}: ${s.url4(tenant)}`).join('\n')}`
  }

  set() {}

  async onEDGE(req) {
    // TODO: cascade the query to the next database if limit is not reached
    // e.g. SELECT.limit.val = 1000 and edge only returns 100 rows
    // Then the query has to be executed on the next database until the limit is reached
    // or no more databases are available
    const ret = await this.dbc[0].run(req.query, req.data)
    return ret
  }

  _applyEvent(dbc, event, req) {
    switch (event) {
      case 'BEGIN':
        return dbc.begin(req)
      case 'COMMIT':
        return dbc.commit(req)
      case 'ROLLBACK':
        return dbc.rollback()
    }
  }

  async onEVENT(req) {
    const event = req.event
    // When the BEGIN event is called only apply it to the edge database
    if (event === 'BEGIN') {
      // Catch up with the delayed events
      this._delayed = () => {
        // Only trigger begin once per transaction
        const prom = Promise.all(this.dbc.slice(1).map(s => this._applyEvent(s, 'BEGIN', req)))
        // Remove delay when the delayed events have finished
        prom.then(() => (this._delayed = undefined))
        // Return the promise to block subsequent requests
        this._delayed = () => prom
        return prom
      }
    }
    // When the the delay has caught up, apply the event to all databases
    const dbc = this._delayed ? this.dbc.slice(0, 1) : this.dbc
    return Promise.all(dbc.map(s => this._applyEvent(s, event, req)))
  }

  async onALL(req) {
    if (this._delayed) {
      // Ensure that the delayed events are applied before the current event
      await this._delayed()
    }
    // Execute all writing actions onto all databases
    const ret = await Promise.all(this.dbc.map(s => s.run(req.query, req.data)))
    return ret.at(-1)
  }

  async disconnect(tenant) {
    // Cascade the disconnect to all databases
    await Promise.all([super.disconnect.call(this, tenant), ...this.services.map(s => s.disconnect(tenant))])
  }

  async database(isolation) {
    // Cascade the database creation to all databases which support it
    await Promise.all(this.services.map(s => s.database?.(isolation)))
  }

  async tenant(isolation) {
    // Cascade the tenant creation to all databases which support it
    await Promise.all(this.services.map(s => s.tenant?.(isolation)))
  }
}

module.exports = EdgeService
