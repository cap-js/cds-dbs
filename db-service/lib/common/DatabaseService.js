const infer = require('../infer')
const cds = require('@sap/cds')

function Pool(factory, tenant) {
  const pool = createPool({ __proto__: factory, create: factory.create.bind(undefined, tenant) }, factory.options)
  pool._trackedConnections = []
  return pool
}
const { createPool } = require('@sap/cds-foss').pool

/** @typedef {unknown} DatabaseDriver */

class DatabaseService extends cds.Service {
  /**
   * Return a pool factory + options property as expected by
   * https://github.com/coopernurse/node-pool#createpool.
   * @abstract
   * @type {import('./factory').Factory<DatabaseDriver>}
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
   * @typedef {Object} DefaultSessionVariables
   * @property {string} '$user.id'
   * @property {string} '$user.locale'
   * @property {string} '$valid.from'
   * @property {string} '$valid.to'
   */

  /**
   * Set one or more session context variables
   * @example
   * ```js
   * const tx = cds.db.tx()
   * tx.set({
   *   '$user.name': 'Alice',
   *   '$user.role': 'admin'
   * })
   * ```
   * @param {unknown|DefaultSessionVariables} variables
   */
  set(variables) {
    variables
    throw '2b overridden by subclass'
  }

  /**
   * @param {import('@sap/cds/apis/cqn').Query} q
   * @param {import('@sap/cds/apis/csn').CSN} m
   * @returns {import('../infer/cqn').Query}
   */
  infer(q, m = this.model) {
    return infer(q, m)
  }

  /**
   * @returns {Promise<DatabaseService>}
   */
  async begin() {
    const ctx = this.context
    if (!ctx) return this.tx().begin()
    const tenant = this.isMultitenant && ctx.tenant
    const pool = (this.pools[tenant] ??= new Pool(this.pools._factory, tenant))
    const connections = pool._trackedConnections
    let dbc
    try {
      /** @type {DatabaseDriver} */
      dbc = this.dbc = await pool.acquire()
    } catch (err) {
      // TODO: add acquire timeout error check
      err.stack += `\nActive connections:${connections.length}\n${connections.map(c => c._beginStack.stack).join('\n')}`
      throw err
    }
    this._beginStack = new Error('begin called from:')
    connections.push(this)
    /**
     * @param {DatabaseDriver} dbc
     */
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
        // REVISIT: should be decided in spec meeting for definitive name
        get '$now'() {
          return _set(this, '$now', (ctx.timestamp || new Date()).toISOString())
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
  /**
   * @param {string} tenant
   */
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
   * @param {unknown} data
   * @param  {...unknown} etc
   * @returns {Promise<unknown>}
   */
  run(query, data, ...etc) {
    // Allow db.run('...',1,2,3,4)
    if (data !== undefined && typeof query === 'string' && typeof data !== 'object') data = [data, ...etc]
    return super.run(query, data)
  }

  /**
   * Generated the database url for the given tenant
   * @param {string} tenant
   * @returns {string}
   */
  url4(tenant) {
    tenant
    let { url } = this.options?.credentials || this.options || {}
    return url
  }

  /**
   * Old name of url4
   * @deprecated
   * @param {string} tenant
   * @returns {string}
   */
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
