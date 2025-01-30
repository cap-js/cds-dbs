const SessionContext = require('./session-context')
const ConnectionPool = require('./generic-pool')
const infer = require('../infer')
const cds = require('@sap/cds')

const databaseModel = cds.linked({
  definitions: {
    schemas: new cds.entity({
      kind: 'entity',
      elements: {
        tenant: { type: 'String', key: true },
        source: { type: 'String' },
        available: { type: 'Boolean' },
        started: { type: 'Timestamp' },
      },
    }),
  }
})
databaseModel.meta = {}

/** @typedef {unknown} DatabaseDriver */

class DatabaseService extends cds.Service {

  async init() {
    cds.on('shutdown', () => this.disconnect())
    if (Object.getOwnPropertyDescriptor(cds, 'test') || this.options.isolate) {
      await this._isolate()
    }
    return super.init()
  }

  async _isolate() {
    const { options = {} } = cds
    const fts = cds.requires.toggles && cds.resolve(cds.env.features.folders)
    const src = [options.from || '*', ...(fts || [])]
    const fullSrc = [cds.root, ...src.flat()]

    const isolate = { src }
    if (typeof this.database === 'function' && typeof this.tenant === 'function') {
      const hash = str => {
        const { createHash } = require('crypto')
        const hash = createHash('sha1')
        hash.update(str)
        return hash.digest('hex')
      }

      const isolation = process.env.TRAVIS_JOB_ID || process.env.GITHUB_RUN_ID || require('os').userInfo().username || 'test_db'
      const srchash = hash(fullSrc.join('/'))
      // Create one database for each overall test execution
      isolate.database = 'D' + hash(isolation)
      // Create one tenant for each model source definition
      isolate.tenant = 'T' + srchash
      // Track source definition hash
      isolate.source = srchash

      // Create new database isolation
      await this.database(isolate)

      let isnew = false
      try {
        await this.tx(tx => tx.run(CREATE(databaseModel.definitions.schemas))).catch(() => { })
        await this.tx(async tx => {
          tx.model = databaseModel
          await tx.run(DELETE.from('schemas').where`tenant=${isolate.tenant} and available=${false} and seconds_between(started, $now) > ${120}`)
          // If insert works the schema does not yet exist and this client has won the race and can deploy the contents
          await tx.run(INSERT({ tenant: isolate.tenant, source: isolate.source, available: false, started: new Date() }).into('schemas'))
          isnew = true
        })
      } catch (err) {
        const query = SELECT.from('schemas').where`tenant=${isolate.tenant} and available=${true}`
        // If the schema already exists wait for the row to be updated with available=true
        await this.tx(async tx => {
          tx.model = databaseModel
          let available = []
          while (available.length === 0) available = await tx.run(query)
        })
      }

      // Create/Activate tenant isolation in database
      await this.tenant(isolate)

      if (isnew) {
        let err
        await this._isolate_deploy(isolate).catch(e => { err = e })
        await this.database(isolate)
        await this.tx(async tx => {
          tx.model = databaseModel
          if (err) {
            await tx.run(DELETE('schemas').where`tenant=${isolate.tenant}`)
          } else {
            await tx.run(UPDATE('schemas').where`tenant=${isolate.tenant}`.with({ available: true, started: new Date() }))
          }
        })
        if (err) throw err
        await this.tenant(isolate)
      }
    } else {
      await this._isolate_deploy(isolate)
    }

    if (typeof this.database === 'function' && typeof this.tenant === 'function') {
      this._modified = {}
      this.before(['*'], async (req) => {
        if (
          !req.query ||
          req.query?.SELECT ||
          (typeof req.query === 'string' && /^(BEGIN|COMMIT|ROLLBACK|SELECT)/i.test(req.query))
        ) return // Ignore reading requests
        if (req.target) this._modified[req.target.name] = true
        if (req.tx._isolating) return req.tx._isolating
        if (this._isolating) return

        // Add modification tracking for deep-queries internal calls
        for (const fn of ['onSIMPLE', 'onUPDATE', 'onINSERT']) {
          const org = this[fn]
          this[fn] = function (req) {
            if (req.query?.target) this._modified[req.query.target.name] = true
            return org.apply(this, arguments)
          }
        }

        this._isolating = true
        return (req.tx._isolating = req.tx.commit()
          .then(() => this._isolate_write(isolate))
          .then(() => {
            return req.tx.begin()
          }))
      })
    }
  }

  async _isolate_write(isolate) {
    await this.database(isolate)

    let isnew = false
    await this.tx(async tx => {
      tx.model = databaseModel
      const schemas = await tx.run(SELECT.from('schemas').where`tenant!=${isolate.tenant} and source=${isolate.source} and available=${true}`.forUpdate().limit(1))
      if (schemas.length) {
        const tenant = isolate.tenant = schemas[0].tenant
        await tx.run(UPDATE('schemas').where`tenant=${tenant}`.with({ available: false, started: new Date() }))
      } else {
        isolate.tenant = 'T' + cds.utils.uuid()
        await tx.run(INSERT({ tenant: isolate.tenant, source: isolate.source, available: false, started: new Date() }).into('schemas'))
        isnew = true
      }
      delete this._modified.schemas // REVISIT: make sure to not track schemas modifications
    })

    await this.tenant(isolate)

    if (isnew) await this._isolate_deploy(isolate)

    // Release schema for follow up test runs
    cds.on('shutdown', async () => {
      try {
        // Clean tenant entities
        await this.tx(async tx => {
          await tx.begin()
          for (const entity in this._modified) {
            const query = DELETE(entity).where`true=true`
            if (!query.target._unresolved) await tx.onSIMPLE({ query }) // Skip deep delete
          }
          // UPSERT all data sources again
          await cds.deploy.data(tx, tx.model, { schema_evolution: 'auto' })
        })

        await this.database(isolate) // switch back to database level
        await this.tx(tx => {
          tx.model = databaseModel
          return UPDATE('schemas').where`tenant=${isolate.tenant}`.with({ available: true })
        })
        await this.disconnect()
      } catch (err) {
        // if an shutdown handler throws an error it goes into an infinite loop
        debugger
      }
    })
  }

  async _isolate_deploy(isolate) {
    await this.tx(async () => {
      try {
        const src = isolate.src
        const { options = {} } = cds
        const m = await cds.load(src, options).then(cds.minify)
        // options.schema_evolution = 'auto'
        await cds.deploy(m).to(this, options)
      } catch (err) {
        if (err.code === 'MODEL_NOT_FOUND' || err.code === 288) return
        throw err
      }
    })
  }

  /**
   * Dictionary of connection pools per tenant
   */
  pools = Object.setPrototypeOf({}, { _factory: this.factory })

  /**
   * Return a pool factory + options property as expected by
   * https://github.com/coopernurse/node-pool#createpool.
   * @abstract
   * @type {import('./factory').Factory<DatabaseDriver>}
   */
  get factory() {
    throw '2b overriden in subclass'
  }

  /**
   * Set one or more session context variables like so:
   *
   *     const tx = cds.db.tx()
   *     tx.set({ foo: 'bar' })
   *
   * This is used in this.begin() for standard properties
   * like `$user.id` or `$user.locale`.
   */
  // eslint-disable-next-line no-unused-vars
  set(variables) {
    throw '2b overridden by subclass'
  }

  /**
   * Acquires a pooled connection and starts a session, including setting
   * session context like `$user.id` or `$user.locale`, and starting a
   * transaction with `BEGIN`
   * @returns this
   */
  async begin(min) {
    // We expect tx.begin() being called for an txed db service
    const ctx = this.context

    // If .begin is called explicitly it starts a new transaction and executes begin
    if (!ctx) return this.tx().begin(min)

    // REVISIT: can we revisit the below revisit now?
    // REVISIT: tenant should be undefined if !this.isMultitenant
    let isMultitenant = 'multiTenant' in this.options ? this.options.multiTenant : cds.env.requires.multitenancy
    let tenant = isMultitenant && ctx.tenant

    // Setting this.pool as used in this.acquire() and this.release()
    this.pool = this.pools[tenant] ??= new ConnectionPool(this.pools._factory, tenant)

    // Acquire a pooled connection
    this.dbc = await this.acquire()
    this.dbc.destroy = this.destroy.bind(this) // REVISIT: this is bad

    // Begin a session...
    if (!min) try {
      await this.set(new SessionContext(ctx))
      await this.send('BEGIN')
    } catch (e) {
      this.release()
      throw e
    }
    return this
  }

  /**
   * Commits a transaction and releases the connection to the pool.
   */
  async commit() {
    if (!this.dbc) return
    await this.send('COMMIT')
    this.release() // only release on successful commit as otherwise released on rollback
  }

  /**
   * Rolls back a transaction and releases the connection to the pool.
   */
  async rollback() {
    if (!this.dbc) return
    try {
      await this.send('ROLLBACK')
    } finally {
      this.release()
    }
  }

  /**
   * Acquires a connection from this.pool, stored into this.dbc
   * This is for subclasses to intercept, if required.
   */
  async acquire() {
    return await this.pool.acquire()
  }

  /**
   * Releases own connection, i.e. tix.dbc, from this.pool
   * This is for subclasses to intercept, if required.
   */
  async release() {
    if (!this.dbc) return
    const dbc = this.dbc
    this.dbc = undefined
    await this.pool.release(dbc)
  }

  /**
   * Destroys own connection, i.e. tix.dbc, from this.pool
   * This is for subclasses to intercept, if required.
   */
  async destroy() {
    if (!this.dbc) return
    const dbc = this.dbc
    this.dbc = undefined
    await this.pool.destroy(dbc)
  }

  // REVISIT: should happen automatically after a configurable time
  async disconnect(tenant) {
    const tenants = tenant ? [tenant] : Object.keys(this.pools)
    await Promise.all(tenants.map(async t => {
      const pool = this.pools[t]; if (!pool) return
      delete this.pools[t]
      await pool.drain()
      await pool.clear()
    }))
  }

  /**
   * Infers the given query with this DatabaseService instance's model.
   * In general `this.model` is the same then `cds.model`
   * @param {CQN} query - the query to infer
   * @returns {CQN} the inferred query
   */
  infer(query) {
    return infer(query, this.model)
  }

  /**
   * DatabaseServices also support passing native query strings to underlying databases.
   */
  run(query, data, ...etc) {
    // Allow db.run('...',1,2,3,4)
    if (data !== undefined && typeof query === 'string' && typeof data !== 'object') arguments[1] = [data, ...etc]
    return super.run(...arguments) //> important to call like that for tagged template literal args
  }

  /**
   * @returns {string} A url-like string used to print log output,
   * e.g., in cds.deploy()
   */
  url4(/*tenant*/) {
    return this.options.credentials?.url || this.options.url
  }
}

DatabaseService.prototype.isDatabaseService = true
module.exports = DatabaseService
