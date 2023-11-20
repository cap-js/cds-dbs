const SessionContext = require('./session-context')
const ConnectionPool = require('./generic-pool')
const infer = require('../infer')
const cds = require('@sap/cds/lib')

/** @typedef {unknown} DatabaseDriver */

class DatabaseService extends cds.Service {

  init() {
    cds.on('shutdown', () => this.disconnect())
    return super.init()
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
  async begin() {
    // We expect tx.begin() being called for an txed db service
    const ctx = this.context

    // If .begin is called explicitly it starts a new transaction and executes begin
    if (!ctx) return this.tx().begin()

    // REVISIT: tenant should be undefined if !this.isMultitenant
    let isMultitenant = 'multiTenant' in this.options ? this.options.multiTenant : cds.env.requires.multitenancy
    let tenant = isMultitenant && ctx.tenant

    // Setting this.pool as used in this.acquire() and this.release()
    this.pool = this.pools[tenant] ??= new ConnectionPool(this.pools._factory, tenant)

    // Acquire a pooled connection
    this.dbc = await this.acquire()

    // Begin a session...
    try {
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
    await this.pool.release(this.dbc)
    this.dbc = undefined
  }

  // REVISIT: should happen automatically after a configurable time
  /**
   * @param {string} tenant
   */
  async disconnect(tenant) {
    const _disconnect = async tenant => {
      const pool = this.pools[tenant]
      if (!pool) {
        return
      }
      await pool.drain()
      await pool.clear()
      delete this.pools[tenant]
    }
    if (tenant == null)
      return Promise.all(Object.keys(this.pools).map(_disconnect))
    return _disconnect(tenant)
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
    if (data !== undefined && typeof query === 'string' && typeof data !== 'object') data = [data, ...etc]
    return super.run(query, data)
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
