const { DatabaseService } = require('@cap-js/db-service')
const cds = require('@sap/cds/lib')

class FractalService extends DatabaseService {
  init() {
    // Inherit dialect from source for successfull deployment
    this.options.dialect = cds.requires[this.options.source].dialect

    this.on(['*'], this.onQuery)
    this.on(['*'], this.onPlainSQL)

    this._source = cds.connect.to(this.options.source)
    this._cache = cds.connect.to(this.options.cache)
      .then(async cache => {
        // REVISIT: deploy without default data (unless garanteed static)
        // Prepare model in the cache service for faster cold cache access
        await cache.tx(tx => cds.deploy(cds.options.from).to(tx))
        return cache
      })

    this._tokens = {}

    return super.init(...arguments)
  }

  get factory() {
    return {}
  }

  async begin() {
    const ctx = this.context
    if (!ctx) return this.tx().begin()
    const lazy = prop => {
      Object.defineProperty(this, prop, {
        get() {
          this[prop + 'Active'] = true
          const prom = this['_' + prop]
            .then(srv => srv.begin())
          Object.defineProperty(this, prop, {
            value: prom
          })
          return this[prop]
        },
        configurable: true,
      })
    }
    lazy('source')
    lazy('cache')
    return this
  }

  async _proxy(func) {
    const srv = []
    if (this.sourceActive) {
      srv.push(await this.source)
    }
    if (this.cacheActive) {
      srv.push(await this.cache)
    }
    return Promise.all((await Promise.all(srv)).map(srv => srv[func]()))
  }
  async commit() { return this._proxy('commit') }
  async rollback() { return this._proxy('rollback') }
  async acquire() { return this._proxy('acquire') }
  async release() { return this._proxy('release') }
  async destroy() { return this._proxy('destroy') }

  url4(tenant) {
    return 'db-fractal'
  }

  set(variables) {

  }

  // REVISIT: Forward token grant requests to instance(0)
  // REVISIT: Grant tokens based upon source tables
  async grantToken(req, resource) {
    await new Promise(resolve => setTimeout(resolve, 1))
    const tokens = resource.tokens * -1
    const validTo = new Date()
    validTo.setUTCMinutes(validTo.getUTCMinutes() + 1)
    return {
      id: resource.id,
      // 'source', 'cache', 'instance(n)'
      target: tokens > 1 && process.env.FRACTAL_CACHE !== 'false' ? 'cache' : 'source',
      tokens: tokens,
      validTo: validTo.getTime(),
    }
  }

  async getToken(req, retry = false) {
    const { tenant, target } = req
    const key = `${tenant}:${target}`
    const defaultResource = { id: key, tokens: 0 }
    const resource = this._tokens[key] ??= defaultResource

    // If the resouce is no longer valid
    if (resource.validTo < Date.now()) {
      await this.flushCache(req, resource)
      this._tokens[key] = defaultResource
      return this.getToken(req)
    }
    // If the target is the local cache ignore tokens
    if (resource.target === 'cache') {
      if (req.event !== 'SELECT') resource.changed = true
      return resource
    }
    // Consume available token
    if (!retry && resource.tokens-- > 0) return resource
    // Queue current request to existing update request
    if (resource.prom && !retry) return resource.prom
    // Intialize new resource tokens request
    return (resource.prom = this.grantToken(req, resource)
      .then(async newResource => {
        newResource.tokens += resource.tokens
        this._tokens[key] = newResource
        if (newResource.target === 'cache') {
          await this.getCache(req, resource)
        }
        return newResource
      })
      // REVISIT: Make sure that all token requests resolve
      .catch(() => this.getToken(req, true))
    )
  }

  async getCache(req, resource) {
    try {
      const cache = await this._cache
      const source = await this._source
      // Update local cache with the current state of the source database
      await cache.tx(async tx => tx.run(
        UPSERT(await source.tx(tx => tx.run(SELECT.from(req.target))))
          .into(req.target)
      ))
    } catch (e) {
      delete this._tokens[resource.id]
    }
  }

  async flushCache(req, resource) {
    if (!resource.changed) return // No write operations so no flush
    const cache = await this._cache
    const source = await this._source
    await source.tx(async tx => {
      const targetState = await cache.tx(tx => tx.run(SELECT.from(req.target)))

      // Delete all entries which no longer exist in the cache
      // REVISIT: this approach works, but also sends all data an additional time
      //          Could be more efficient by tracking the DELETE clauses
      const elements = Object.keys(req.target.keys ?? req.target.elements)
      await tx.run(DELETE.from(req.target).where([
        'not',
        { list: elements.map(k => ({ ref: [k] })) },
        'in',
        { list: targetState.map(row => ({ list: elements.map(e => ({ val: row[e] })) })) }
      ]))

      // UPSERT the current state of the cache into the source database
      // REVISIT: this is a very straight forward approach. Could be optimized.
      //          By tracking the INSERT, UPSERT and UPDATE queries and filter
      return tx.run(UPSERT(targetState).into(req.target))
    })
  }

  // queue queries until tokens are granted
  async onQuery(req, next) {
    if (!req.target) return next()
    const resource = await this.getToken(req)
    const srv = await this[resource.target]
    const ret = await srv.dispatch(req)
    return ret
  }

  async onPlainSQL(req, next) {
    return (await this.source).onPlainSQL(req, next)
  }

  async disconnect(tenant) {
    const [source, cache] = await Promise.all([this._source, this._cache])
    await Promise.all([source.disconnect(tenant), cache.disconnect(tenant)])
  }

  async database(isolate) {
    const source = await this._source
    return source.database(isolate)
  }

  async tenant(isolate) {
    const source = await this._source
    return source.tenant(isolate)
  }
}

module.exports = FractalService
