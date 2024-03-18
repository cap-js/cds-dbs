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

  // Should be handeled by instance 0
  async grantToken(req, resource) {
    await new Promise(resolve => setTimeout(resolve, 1))
    const tokens = resource.tokens * -1
    const validTo = new Date()
    validTo.setUTCMinutes(validTo.getUTCMinutes() + 1)
    return {
      id: resource.id,
      // 'source', 'cache', 'instance(n)'
      target: tokens > 1 && process.env.FRACT_CACHE ? 'cache' : 'source',
      tokens: tokens,
      validTo: validTo.getTime(),
    }
  }

  async getToken(req) {
    const { tenant, target } = req
    const key = `${tenant}:${target}`
    const defaultResource = { id: key, tokens: 0 }
    const resource = this._tokens[key] ??= defaultResource

    // If the resouce is no longer valid
    if (resource.validTo < Date.now()) {
      this._tokens[key] = defaultResource
      return this.getToken(req)
    }
    // If the target is the local cache ignore tokens
    if (resource.target === 'cache') return resource
    // Consume available token
    if (resource.tokens-- > 0) return resource
    // Queue current request to existing update request
    if (resource.prom) return resource.prom
    // Intialize new resource tokens request
    return (resource.prom = this.grantToken(req, resource)
      .then(async newResource => {
        newResource.tokens += resource.tokens
        this._tokens[key] = newResource
        if (newResource.target === 'cache') {
          try {
            await (await this._cache).tx(tx => {
              return cds.deploy(cds.options.from).to(tx)
            })
          } catch (e) {
            debugger
          }
        }
        return newResource
      })
    )
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
