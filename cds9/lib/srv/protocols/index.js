const cds = require('../../index')

/**
 * Provides canonic access to configured protocols as well as helper methods.
 * Instance of this class is available as cds.service.protocols.
 */
class Protocols {

  // Built-in protocols
  'odata-v4' = { path: '/odata/v4', impl: './odata-v4' }
  'odata-v2' = '/odata/v2'
  'odata' = this['odata-v4']
  'rest' = '/rest'
  'hcql' = '/hcql'

  /** Allows changing the default in projects */
  default = 'odata'


  constructor (conf = cds.env.protocols||{}) {
    // Make helpers non-enumerable and bound functions
    const protocols = Object.defineProperties (this, {
      default: { writable: true, enumerable:false, value: this.default }, // makes it non-enumerable
      serve: { writable:true, configurable:true, value: this.serve.bind(this) },
    })
    for (let [k,p] of Object.entries(this)) this[k] = _canonic (k,p)
    for (let [k,p] of Object.entries(conf)) this[k] = _canonic (k,p,'merge')
    function _canonic (kind,p,merge) {
      if (typeof p === 'string') p = { path:p }
      if (merge) p = { ...protocols[kind], ...p }
      if (!p.impl) p.impl = './'+kind
      if (!p.path.startsWith('/')) p.path = '/'+p.path
      if (p.path.endsWith('/')) p.path = p.path.slice(0,-1)
      return p
    }
  }


  get debug() {
    // Doing this lazy to avoid eager loading of cds.env
    return super.debug = cds.debug('adapters')
  }

  /**
   * Constructs a new adapter for the given service, and mounts it to an express app.
   */
  serve (srv, /* in: */ app, { before, after } = cds.middlewares) {

    const endpoints = srv.endpoints ??= this.endpoints4(srv)
    const cached = srv._adapters ??= {}
    let n = 0

    if (app) {
      // disable express etag handling
      app.disable?.('etag')
      // app.disable('x-powered-by')
    }

    if (endpoints) for (let { kind, path } of endpoints) {

      // construct adapter instance from resolved implementation
      let adapter = cached[kind]; if (!adapter) {
        const conf = this[kind] ??= {}
        let { impl } = conf; if (typeof impl !== 'function') try {
          if (impl[0] === '.') impl = __dirname+impl.slice(1)
          else impl = require.resolve(impl,{paths:[cds.root]})
          impl = conf.impl = require(impl)
        } catch { cds.error `Cannot find impl for protocol adapter: ${impl}` }
        adapter = cached[kind] = impl.prototype ? new impl(srv, conf) : impl(srv, conf)
        if (!adapter) continue
      }

      // handle first as default adapter
      if (n++ === 0) {
        adapter.path = srv.path = path
        cached._default = adapter
        if (!app) return adapter //> when called without app, construct and return default adapter only

        // Add a reject-all handler for non-existing static /webapp resources, which would lead
        // to lots of "UriSemanticError: 'webapp' is not an entity set, ..." errors, if the
        // service path and static app root path are the same, e.g. /browse in bookshop.
        if (!path.match(/^\/.+\/.+/)) app.use (`${path}/webapp/`, (_,res) => res.sendStatus(404))
      }

      // mount adapter to express app
      this.debug?.('app.use(', path, ', ... )')
      app.use (path, before, adapter, after)
    }
  }

  /**
   * Returns the endpoints for the given instance of cds.Service.
   * Used in this.serve() and the outcome stored in srv.endpoints property.
   * IMPORTANT: Currently only used internally in this module, e.g. serviceinfo,
   * and should stay that way -> don't use anywhere else.
   * @returns {{ kind:string, path:string }[]} Array of { kind, path } objects
   */
  endpoints4 (srv, o = srv.options) {
    const def = srv.definition || {}

    // get @protocol annotations from service definition
    let annos = o?.to || def['@protocol']
    if (annos) {
      if (annos === 'none' || annos['='] === 'none') return []
      if (!annos.reduce) annos = [annos]
    }
    // get @odata, @rest annotations
    else {
      annos=[]; for (let kind in this) {
        let path = def['@'+kind] || def['@protocol.'+kind]
        if (path) annos.push ({ kind, path })
      }
    }
    // no annotations at all -> use default protocol
    if (!annos.length) annos.push ({ kind: this.default })

    // canonicalize to { kind, path } objects
    const endpoints = annos.map (each => {
      let { kind = each['='] || each, path } = each
      if (!(kind in this))
        return cds.log('adapters').warn ('ignoring unknown protocol:', kind)
      if (typeof path !== 'string') path = o?.at || o?.path || def['@path'] || _slugified(srv.name)
      if (path[0] !== '/') path = this[kind].path + '/' + path // prefix with protocol path
      return { kind, path }
    }) .filter (e => e) //> skipping unknown protocols

    return endpoints //.length ? endpoints : null
  }

  /**
   * Rarely used, e.g., by compile.to.openapi:
   * NOT PUBLIC API, hence not documented.
   */
  path4 (srv,o) {
    if (!srv.definition) srv = { definition: srv, name: srv.name } // fake srv object
    const endpoints = srv.endpoints ??= this.endpoints4(srv,o)
    return endpoints[0]?.path
  }

  /**
   * Internal modules may use this to determine if the service is configured to serve OData.
   * NOT PUBLIC API, hence not documented.
   */
  for (def) {
    const protocols={}; let any

    // check @protocol annotation -> deprecated, only for 'none'
    let a = def['@protocol']
    if (a) {
      const pa = a['='] || a
      if (pa === 'none') return protocols
      if (typeof pa === 'string') any = protocols[pa] = 1
      else for (let p of pa) any = protocols[p.kind||p] = 1
    }

    // @odata, @rest, ... annotations -> preferred
    else for (let p in this) if (def['@'+p] || def['@protocol.'+p]) any = protocols[p] = 1

    // add default protocol, if none is annotated
    if (!any) protocols[this.default] = 1

    // allow for simple 'odata' in srv.protocols checks
    if (protocols['odata-v4']) protocols.odata = 1

    return protocols
  }
}


// Return a sluggified variant of a service's name
const _slugified = name => (
  /[^.]+$/.exec(name)[0]      //> my.very.CatalogService --> CatalogService
  .replace(/Service$/,'')     //> CatalogService --> Catalog
  .replace(/_/g,'-')          //> foo_bar_baz --> foo-bar-baz
  .replace(/([a-z0-9])([A-Z])/g, (_,c,C) => c+'-'+C)  //> ODataFooBarX9 --> OData-Foo-Bar-X9
  .toLowerCase()              //> FOO --> foo
)


module.exports = new Protocols
