const infer = require('../infer')
const cds = require('@sap/cds')

const { Readable } = require('stream')

function Pool(factory, tenant) {
  const pool = createPool({ __proto__: factory, create: factory.create.bind(undefined, tenant) }, factory.options)
  pool._trackedConnections = []
  pool.on('factoryCreateError', e => {
    if (typeof factory.error === 'function') return factory.error(e, tenant)
    cds.error`Failed to create database connection for tenant "${tenant}":\n${e.stack || e}`
  })
  return pool
}
const { createPool } = require('@sap/cds-foss').pool

class DatabaseService extends cds.Service {
  /**
   * Return a pool factory + options property as expected by
   * https://github.com/coopernurse/node-pool#createpool.
   */
  get factory() {
    throw '2b overriden in subclass'
  }
  pools = { _factory: this.factory }

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
   * @param {Object} variables The session variables to be set
   */
  async set(variables) {
    variables
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
        get '$user.now'() {
          return _set(this, '$user.now', (ctx.timestamp || new Date()).toISOString())
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

  async commit(res) {
    const dbc = this.dbc
    if (!dbc) return

    const _commit = async delayed => {
      if (delayed) {
        this.ready = true
        this._done = false
      }

      await this.send('COMMIT')
      this._release(dbc) // only release on successful commit as otherwise released on rollback
    }

    if (res instanceof Readable) {
      new Promise((resolve, reject) => {
        res.on('error', reject)
        res.on('end', resolve)
        res.on('close', resolve)
        res.on('finish', resolve)
      }).then(
        () => _commit(true),
        e => this.rollback(e),
      )
      return
    }
    return _commit()
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

  run(query, data, ...etc) {
    // Allow db.run('...',1,2,3,4)
    if (data !== undefined && typeof query === 'string' && typeof data !== 'object') data = [data, ...etc]
    return super.run(query, data)
  }

  /**
   * Provides the url for the target tenant based upon the configurations
   * @param {string|undefined} tenant The tenant UUID or undefined for single tenant applications
   * @returns {string} The url of the tenant
   */
  url4(tenant) {
    tenant
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
