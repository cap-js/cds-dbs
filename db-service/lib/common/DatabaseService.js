const infer = require('../infer')
const cds = require('@sap/cds')

function Pool(factory, tenant) {
  const pool = createPool({ __proto__: factory, create: factory.create.bind(undefined, tenant) }, factory.options)
  pool._trackedConnections = []
  return pool
}
const { createPool } = require('@sap/cds-foss').pool

class DatabaseService extends cds.Service {
  /**
   * Return a pool factory + options property as expected by
   * https://github.com/coopernurse/node-pool#createpool.
   * @abstract
   * @type {import('./factory').Factory}
   */
  get factory() {
    throw '2b overriden in subclass'
  }
  pools = { _factory: this.factory }

  /**
   * @returns {boolean} whether this service is multi tenant enabled
   */
  get isMultitenant() {
    return 'multiTenant' in this.options ? this.options.multiTenant : cds.env.requires.multitenancy
  }

  /**
   * Set one or more session context variables like so:
   * ```js
   * const tx = cds.db.tx()
   * tx.set({
   *   '$user.name': 'Alice',
   *   '$user.role': 'admin'
   * })
   * ```
   */
  // eslint-disable-next-line no-unused-vars
  set(variables) {
    throw '2b overridden by subclass'
  }

  infer(q, m = this.model) {
    return infer(q, m)
  }

  async begin() {
    const ctx = this.context
    if (!ctx) return this.tx().begin()
    const tenant = this.isMultitenant && ctx.tenant
    const pool = (this.pools[tenant] ??= new Pool(this.pools._factory, tenant))
    const connections = pool._trackedConnections
    let dbc
    try {
      dbc = this.dbc = await pool.acquire()
    } catch (err) {
      // TODO: add acquire timeout error check
      err.stack += `\nActive connections:${connections.length}\n${connections.map(c => c._beginStack.stack).join('\n')}`
      throw err
    }
    this._beginStack = new Error('begin called from:')
    connections.push(this)
    this._release = async dbc => {
      await pool.release(dbc)
      connections.splice(connections.indexOf(this), 1)
    }
    try {
      // Setting session context variables
      await this.set({
        get '$user.id'() {
          return _set(this, '$user.id', ctx.user?.id || 'anonymous')
        },
        get '$user.locale'() {
          return _set(this, '$user.locale', ctx.locale || cds.env.i18n.default_language)
        },
        get '$valid.from'() {
          return _set(this, '$valid.from', ctx._?.['VALID-FROM'] ?? ctx._?.['VALID-AT'] ?? '1970-01-01T00:00:00.000Z')
        },
        get '$valid.to'() {
          return _set(
            this,
            '$valid.to',
            ctx._?.['VALID-TO'] ?? _validTo4(ctx._?.['VALID-AT']) ?? '9999-11-11T22:22:22.000Z',
          )
        },
      })
      // Run BEGIN
      await this.send('BEGIN')
    } catch (e) {
      this._release(dbc)
      throw e
    }
    return this
  }

  async commit() {
    const dbc = this.dbc
    if (!dbc) return
    await this.send('COMMIT')
    this._release(dbc) // only release on successful commit as otherwise released on rollback
  }

  async rollback() {
    const dbc = this.dbc
    if (!dbc) return
    try {
      await this.send('ROLLBACK')
    } finally {
      this._release(dbc)
    }
  }

  // REVISIT: should happen automatically after a configurable time
  async disconnect(tenant) {
    const pool = this.pools[tenant]
    if (pool) delete this.pools[tenant]
    else return
    await pool.drain()
    await pool.clear()
  }

  /**
   * Runs a Query on the database service
   * @param {import("@sap/cds/apis/cqn").Query} query
   * @param {any} data
   * @param  {...any} etc
   * @returns {Promise<any>}
   */
  run(query, data, ...etc) {
    // Allow db.run('...',1,2,3,4)
    if (data !== undefined && typeof query === 'string' && typeof data !== 'object') data = [data, ...etc]
    return super.run(query, data)
  }

  url4(/*tenant*/) {
    // eslint-disable-line no-unused-vars
    let { url } = this.options?.credentials || this.options || {}
    return url
  }
  getDbUrl(tenant) {
    return this.url4(tenant)
  } // REVISIT: Remove after cds v6.7
}

const _set = (context, variable, value) => {
  Object.defineProperty(context, variable, { value, configurable: true })
  return value
}
const _validTo4 = validAt => {
  return validAt?.replace(/(\dZ?)$/, d => parseInt(d[0]) + 1 + d[1] || '')
}

DatabaseService.prototype.isDatabaseService = true
module.exports = DatabaseService
