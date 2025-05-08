const cds = require('..')
const LOG = cds.log('cds.serve',{label:'cds'})

/** @import Service from './cds.Service' */
/** @param {Service} srv */
module.exports = function (srv = this) {
  if ( !srv.definition ) return //> can only add shortcuts for actions declared in service models
  if ( srv.isAppService || srv.isExternal || srv._add_stub_methods ) {
    for (const each of srv.actions)
      add_handler_for (srv, each)
    for (const each of srv.entities)
      for (const a in each.actions)
        add_handler_for (srv, each.actions[a])
  }
}

/** @param {Service} srv */
const add_handler_for = (srv, def) => {
  const event = def.name.match(/\w*$/)[0]

  // Use existing methods as handler implementations
  const method = srv[event]
  if (method) {
    if (method._is_stub) return
    const baseclass = (
      srv.__proto__ === cds.ApplicationService.prototype ? srv.__proto__ :
      srv.__proto__ === cds.RemoteService.prototype ? srv.__proto__ :
      srv.__proto__.__proto__ // in case of class-based impls
    )
    if (event in baseclass) return LOG.warn(`WARNING: custom ${def.kind} '${event}()' conflicts with method in base class.

      Cannot add typed method for custom ${def.kind} '${event}' to service impl of '${srv.name}',
      as this would shadow equally named method in service base class '${baseclass.constructor.name}'.
      Consider choosing a different name for your custom ${def.kind}.
      Learn more at https://cap.cloud.sap/docs/guides/providing-services#actions-and-functions.
    `)
    LOG.debug (`
      Using method ${event} from service class '${baseclass.constructor.name}'
      as handler for ${def.kind} '${event}' in service '${srv.name}'
    `)
    srv.on (event, function ({params,data}) {
      const args = []; if (def.parent) args.push (def.parent)
      for (let p in params) args.push(params[p])
      for (let p in data) args.push(data[p])
      return method.apply (this,args)
    })
  }

  // Add stub methods to send request via typed API
  LOG.debug (`
    Adding typed method stub for calling custom ${def.kind} '${event}'
    to service impl '${srv.name}'
  `)
  const stub = srv[event] = function (...args) {
    const req = { event, data:{} }, $ = args[0]
    const target = $ && (
      this.model.definitions[ $.name ]
      || this.entities[ $.name?.replace(`${this.name}.`,'') || $ ]
    )
    if (target) {                       //> bound action/function?
      req.target = target; args.shift() // first argument is the target entity name
      req.params = [ args.shift() ]     // second argument is the target's primary key
      if (_consistent_params && typeof req.params[0] !== 'object')
        req.params = [{ [Object.keys(target.keys)[0]]: req.params[0] }]
    }
    const {params} = target ? target.actions[event] : def
    if (params) req.data = _named(args,params) || _positional(args,params)

    return this.send (req)
  }
  Object.defineProperties(stub,{
    name: {value: /[^.]+$/.exec(srv.name)[0] +'.'+ event},
    _is_stub: {value:true},
  })
  const _consistent_params = cds.env.features.consistent_params //> remove with cds^10
}

const _named = (args, declared) => {
  if (args.length > 1) return
  const a = args[0]
  if (! a || typeof a !== 'object') return
  if (Object.keys(a).every (k => k in declared)) return a
}

const _positional = (args, declared) => Object.keys(declared).reduce (
  (data,k,i) => { if (args[i] !== undefined) data[k] = args[i]; return data }, {}
)
