const cds = require('..'), LOG = cds.log('cds.connect')
const _pending = cds.services._pending ??= {} // used below to chain parallel connect.to(<same>)
const TRACE = cds.debug('trace')

/**
 * Connect to a service as primary datasource, i.e. cds.db.
 */
const connect = module.exports = async function cds_connect (options) {
  if (typeof options === 'object' && cds.db) throw cds.error (
    `Re-connect to primary db with potentially different options is not allowed!`
  )
  if (typeof options === 'string') cds.db = await connect.to (options)
  else await connect.to ('db',options)
  return cds
}

/**
 * Connect to a specific service, either served locally, with ad-hoc options
 * or with options configured in cds.env.requires.<datasource>.
 * @param { string|Function|object } [datasource]
 * @param {{ kind?:String, impl?:String }} [options]
 * @returns { Promise<import('./cds.Service')> }
 */
connect.to = (datasource, options) => {
  let Service = cds.service.factory
  if (typeof datasource === 'object' && !datasource.name) [options,datasource] = [datasource] // .to({ options })
  else if (datasource) {
    if (datasource._is_service_class) [ Service, datasource ] = [ datasource, datasource.name ] // .to(ServiceClass)
    else if (datasource.name)  datasource = datasource.name // .to({ name: 'Service' }) from cds-typer
    if (!options) { //> specifying ad-hoc options disallows caching
      if (datasource in cds.services) return Promise.resolve (cds.services[datasource])
      if (datasource in _pending) return _pending[datasource]
    }
  }
  const promise = (async()=>{
    TRACE?.time(`cds.connect.to ${datasource}`.padEnd(22).slice(0,22))
    const o = Service._is_service_class ? {} : options4 (datasource, options)
    const m = await model4 (o)
    // check if required service definition exists
    const required = cds.requires[datasource]
    if (required?.model?.length && datasource !== 'db' && !m.definitions[required.service||datasource]) {
      LOG.error(`No service definition found for '${required.service || datasource}', as required by 'cds.requires.${datasource}':`, required)
      throw new Error (`No service definition found for '${required.service || datasource}'`)
    }
    // construct new service instance
    let srv = await new Service (datasource,m,o); await (Service._is_service_class ? srv.init?.() : Service.init?.(srv))
    if (o.queued || o.outboxed || o.outbox) srv = cds.queued(srv)
    if (datasource && !options) {
      if (datasource === 'db') cds.db = srv
      cds.services[datasource] = srv
      delete _pending[datasource]
    }
    if (!o.silent) cds.emit ('connect',srv)
    TRACE?.timeEnd(`cds.connect.to ${datasource}`.padEnd(22).slice(0,22))
    return srv
  })()
  // queue parallel requests to a single promise, to avoid creating multiple services
  if (datasource && !options) _pending[datasource] = promise
  return promise
}

function options4 (name, _o) {
  const [, kind=_o?.kind, url ] = /^(\w+):(.*)/.exec(name) || []
  const conf = cds.service.bindings.at(name) || cds.requires[name] || cds.requires[kind] || cds.requires.kinds[name] || cds.requires.kinds[kind]
  const o = { kind, ...conf, ..._o }
  if (!o.kind && !o.impl && !o.silent) throw cds.error(
    conf ? `Configuration for 'cds.requires.${name}' lacks mandatory property 'kind' or 'impl'` :
      name ? `Didn't find a configuration for 'cds.requires.${name}' in ${cds.root}` :
        `Provided options object lacks mandatory property 'kind' or 'impl'`
  )
  if (url) o.credentials = { ...o.credentials, url }
  return o
}

function model4 (o) {
  if (o.model?.definitions) return o.model // got a CSN already? -> use it
  if (cds.model) return cds.model         // use global model if available
  if (o.model) return cds.load (o.model) // load specified model from file
}
