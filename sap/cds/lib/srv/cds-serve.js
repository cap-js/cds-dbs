const cds = require ('..')
const Service = cds.service.factory
const _pending = cds.services._pending ??= {}
const _ready = Symbol()
const TRACE = cds.debug('trace')


/** @param som - a service name or a model (name or csn) */
module.exports = function cds_serve (som, _options) { // NOSONAR

  TRACE?.time(`cds.serve ${som}`.padEnd(22).slice(0,22))

  if (som && typeof som === 'object' && !is_csn(som) && !is_files(som)) {
    [som,_options] = [undefined,
      som._is_service_class    ? { service:som, from:'*' } :
      som
    ]
  }
  else if (Array.isArray(som) && som.length === 1) som = som[0]
  const o = {..._options} // we must not modify inbound data

  // Ensure options are filled in canonically based on defaults
  const options = Promise.resolve(o).then (o => { // noformat
    if (o.service)     { o.from     ||( o.from    = som); return o }
    if (o.from)        { o.service  ||( o.service = som); return o }
    if (som === 'all') { o.service ='all'; o.from = '*' ; return o }
    if (is_csn(som))   { o.service ='all'; o.from = som ; return o }
    if (is_files(som)) { o.service ='all'; o.from = som ; return o }
    if (is_class(som)) { o.service = som;  o.from = '?' ; return o }
    else               { o.service = som;  o.from = '*' ; return o }
  })

  // Load/resolve the model asynchronously...
  const loaded = options.then (async ({from}=o) => {
    if (!from || from === 'all' || from === '*') from = cds.model || '*'
    if (from.definitions) return from
    if (from === '?') try { return cds.model || await cds.load('*',o) } catch { return }
    return cds.load(from, {...o, silent:true })
  })

  // Pass 1: Construct service provider instances...
  const all=[], provided = loaded.then (async csn => { // NOSONAR

    // Shortcut for directly passed service classes
    if (o.service?._is_service_class) {
      const Service = o.service, d = { name: o.service.name }
      const srv = await _new (Service, d,csn,o)
      return all.push (srv)
    }

    // Get relevant service definitions from model...
    let {services} = csn = cds.compile.for.nodejs (csn)
    const required = cds.requires
    if (o.service && o.service !== 'all') {
      // skip services not chosen by o.service, if specified
      const specified = o.service.split(/\s*,\s*/).map (s => required[s] && required[s].service || s )
      // matching exact or unqualified name
      services = services.filter (s => specified.some (n => s.name === n || s.name.endsWith('.'+n)))
      if (!services.length) throw cds.error (`No such service: '${o.service}'`)
    }
    services = services.filter (d => !(
      // skip all services marked to be ignored
      d['@cds.ignore'] || d['@cds.serve.ignore'] ||
      // skip external services, unless asked to mock them and unbound
      (d['@cds.external'] || required[d.name]?.external) && (!o.mocked || required[d.name]?.credentials)
    ))
    if (services.length > 1 && o.at) {
      throw cds.error `You cannot specify 'path' for multiple services`
    }

    // Construct service instances and register them to cds.services
    all.push (... await Promise.all (services.map (d => _new (Service,d,csn,o))))
  })

  // Pass 2: Finalize service bootstrapping by calling their impl functions.
  // Note: doing that in a second pass guarantees all own services are in
  // cds.services, so they'll be found when they cds.connect to each others.
  let ready = provided.then (()=> Promise.all (all.map (async srv => {
    cds.services[srv.name] = await Service.init (srv)
    cds.service.providers.push (srv)
    srv[_ready]?.(srv)
    return srv
  })))


  // Return fluent API to fill in remaining options...
  return {

    from (model)  { o.from = model;    return this },
    with (impl)   { o.with = impl;     return this },
    at (path)     { o.at   = path;     return this },
    to (protocol) { o.to   = protocol; return this },

    /** Fluent method to serve constructed providers to express app */
    in (app) {
      const { serve } = cds.service.protocols
      ready = ready.then (()=> all.forEach (each => {
        const d = each.definition || {}
        if (d['@protocol'] === 'none' || d['@cds.api.ignore']) return each._is_dark = true
        else serve (each, /*to:*/ app)
        if (!o.silent) cds.emit ('serving',each)
      }))
      return this
    },

    /**
     * Finally resolve to a single service or a map of many,
     * which can be used like that: @example
     * let { CatalogService } = await cds.serve(...) // single or many
     * let CatalogService = await cds.serve(...)    // single only
     */
    then: (_resolve, _error) => ready.then ((s)=>{
      TRACE?.timeEnd(`cds.serve ${som}`.padEnd(22).slice(0,22))
      if (all.length === 0) return _resolve()
      if (all.length === 1) return _resolve(Object.defineProperty(s=all[0],s.name,{value:s}))
      else return _resolve (all.reduce ((r,s)=>{ r[s.name]=s; return r },{}))
    }, _error),

    catch: (e) => ready.catch(e)
  }
}


async function _new (Service, d,m,o) {
  const srv = await new Service (d.name,m,o)
  const required = cds.requires[d.name]
  if (required) {
    // Object.assign (srv.options, required)
    if (required.name) srv.name = required.name
    if (required.external && o.mocked) srv.mocked = true
  }
  _pending[srv.name] = new Promise (r => srv[_ready]=r).finally(()=>{
    delete _pending[srv.name]
    delete srv[_ready]
    if (srv.mocked) {
      let service = cds.env.requires[srv.name]?.service
      if (service && !cds.services[service]) Object.defineProperty (cds.services, service, {value:srv})
    }
    if (!o.silent) cds.emit (`serving:${srv.name}`, srv)
  })
  return srv
}


const is_csn = x => x && x.definitions
const is_files = x => Array.isArray(x) || typeof x === 'string' && !/^[\w$]*$/.test(x)
const is_class = x => typeof x === 'function' && x.prototype && /^class\b/.test(x)
