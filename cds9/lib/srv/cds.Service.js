const EventHandlers = require('./srv-handlers')
const Request = require('../req/request')
const Event = require('../req/event')
const cds = require('../index')


/**
 * This class constitutes the API used by service consumers to send requests, and emit events.
 *
 * - `dispatch()` - is the central method ultimately called by all the other methods below.
 * - `emit()` - is the central method of the **Messaging API** to emit asynchronous event messages.
 * - `send()` - is the central method of the **Request API** to send synchronous requests.
 * - `run()` - is the central method of the **Querying API** to execute queries.
 *
 * The other methods, like `read`, `create`, `update`, `delete`, are **CRUD-style** syntactical
 * sugar variants provided for convenience, or **REST-style** like `get`, `put`, `post`, `patch`.
 */
class ConsumptionAPI {

  async dispatch() {}

  emit (event, data, headers) {
    if (is_object(event)) return this.dispatch (event instanceof Event ? event : new Event(event))
    else return this.dispatch (new Event ({ event, data, headers }))
  }

  send (req, path, data, headers) {
    if (is_object(req)) return this.dispatch (req instanceof Request ? req : new Request(req))
    if (is_object(path)) return this.dispatch (new Request (path.is_linked //...
      ? { method:req, entity:path, data, headers }
      : { method:req, data:path, headers:data }))
    else return this.dispatch (new Request({ method:req, path, data, headers }))
  }
  schedule (method, path, data, headers) {
    // not great to normalize args... better way? need to 'merge' with after/every
    const req = method instanceof cds.Request ? method : new cds.Request(_nrm4skd(method, path, data, headers))
    return {
      after (ms) {
        req.queue ??= {}
        req.queue.after = ms
        return this
      },
      every (ms) {
        req.queue ??= {}
        req.queue.every = ms
        return this
      },
      then: (r, e) => {
        return cds.queued(this).send(req).then(r, e)
      }
    }
  }
  get    (...args) { return is_rest(args[0]) ? this.send('GET',   ...args) : this.read   (...args) }
  put    (...args) { return is_rest(args[0]) ? this.send('PUT',   ...args) : this.update (...args) }
  post   (...args) { return is_rest(args[0]) ? this.send('POST',  ...args) : this.create (...args) }
  patch  (...args) { return is_rest(args[0]) ? this.send('PATCH', ...args) : this.update (...args) }
  delete (...args) { return is_rest(args[0]) ? this.send('DELETE',...args) : DELETE.from (...args).bind(this) }

  /**
   * Queries can be passed as one of the following:
   * - a CQL tagged template string, which is converted into an instance of `cds.ql.Query`
   * - a CQN object, or an array of such
   * - a native SQL string, with binging parameters in the second argument `data`
   */
  run (query, data) {
    if (query.raw) [ query, data ] = [ cds.ql (...arguments) ]
    const req = new Request ({ query, data })
    return this.dispatch (req)
  }
  read   (...args) { return is_query(args[0]) ? this.run(...args) : SELECT.read(...args).bind(this) }
  insert (...args) { return INSERT(...args).bind(this) }
  create (...args) { return INSERT.into(...args).bind(this) }
  update (...args) { return UPDATE.entity(...args).bind(this) }
  upsert (...args) { return UPSERT(...args).bind(this) }
  exists (...args) { return SELECT.one([1]).from(...args).bind(this) }

  /**
   * Streaming API variant of .run(). Subclasses should override this to support real streaming.
   */
  foreach (query, data, callback) {
    if (!callback)  [ data, callback ] = [ undefined, data ]
    return this.run (query, data) .then (rows => rows.forEach(callback) || rows)
  }

  // Internal-only API to free resources when tenants offboard
  /** @protected */ disconnect(tenant) {} // eslint-disable-line no-unused-vars
}


/**
 * This class provides API used by service providers to reflect
 * their service definitions from a given model.
 */
class ReflectionAPI extends ConsumptionAPI {

  /** @param {import('../core/linked-csn').LinkedCSN} csn */
  set model (csn) {
    super.model = csn ? cds.compile.for.nodejs(csn) : undefined
  }

  /** @type import('../core/classes').service */
  get definition() {
    const defs = this.model?.definitions; if (!defs) return super.definition = undefined
    return super.definition = defs[this.options.service] || defs[this.name]
  }
  get namespace()  {
    return super.namespace  = this.definition?.name
    || this.model?.namespace
    || !this.isDatabaseService && !/\W/.test(this.name) && this.name
    || undefined
  }
  get entities()   { return super.entities = this.reflect (d => d.kind === 'entity') }
  get events()     { return super.events   = this.reflect (d => d.kind === 'event') }
  get types()      { return super.types    = this.reflect (d => !d.kind || d.kind === 'type') }
  get actions()    { return super.actions  = this.reflect (d => d.kind === 'action' || d.kind === 'function') }
  reflect (filter) { return this.model?.childrenOf (this.namespace, filter) || [] }
}


/**
 * This class provides the API used by service providers to add event handlers.
 * It inherits the ConsumptionAPI and ReflectionAPI.
 */
class Service extends ReflectionAPI {

  constructor (name, model, options) { super()
    if (typeof name === 'object') [ model, options, name = _service_in(model) ] = [ name, model ]
    this.name = name || new.target.name // i.e. when called without any arguments
    this.options = options ??= {}
    if (options.kind) this.kind = options.kind // shortcut, e.g. for 'sqlite', ...
    if (model) this.model = model
    this.handlers = new EventHandlers(this)
    this.decorate()
  }
  init(){ return this } //> essentially a constructor without arguments

  // Handler registration API
  prepend (fn) { return this.handlers.prepend.call (this,fn) }
  /** @typedef {( entity?, path?, handler:(req:import('../req/request'))=>{})=> Service} boa */
  /** @type boa */ before (...args) { return this.handlers.register (this, 'before', ...args) }
  /** @type boa */ on     (...args) { return this.handlers.register (this, 'on',     ...args) }
  /** @type boa */ after  (...args) { return this.handlers.register (this, 'after',  ...args) }
  reject (e, path) { return this.handlers.register (this, '_initial', e, path,
    r => r.reject (405, `Event "${r.event}" not allowed for entity "${r.path}".`)
  )}

   // Overrriding `srv.run()` to additionally allow running a function in a managed transaction.
  run (fn) {
    if (typeof fn !== 'function') return super.run (...arguments)
    if (this.context) return fn(this)                       // if this is already a tx -> run fn with this
    const ctx = cds.context, tx = ctx?.tx                   // is there an (open) outer tx? ...
    if (!tx || tx._done === 'committed') return this.tx(fn) // no -> run fn with root tx
    if (tx._done !== 'rolled back') return fn(this.tx(ctx)) // yes -> run fn with nested tx
    else throw this.tx._is_done (tx._done)                  // throw if outer tx was rolled back
  }

  // Inofficial APIs - for internal use only
  /** @protected */ static _is_service_class = true //> for factory
  /** @protected */ get endpoints() { return super.endpoints = cds.service.protocols.endpoints4(this) }
  /** @protected */ set endpoints(p) { super.endpoints = p }
  /** @protected */ get path() { return super.path = cds.service.protocols.path4(this) }
  /** @protected */ set path(p) { super.path = p }

  // Deprecated APIs - kept for backwards compatibility
  /** @deprecated */ get _handlers() { return this.handlers }
  /** @deprecated */ get operations() { return this.actions }
  /** @deprecated */ get transaction() { return this.tx }
  /** @deprecated */ get isExtensible() { return this.model === cds.model && !this.name?.startsWith('cds.xt.') }
}

const { dispatch, handle } = require('./srv-dispatch')
Service.prototype.dispatch = dispatch
Service.prototype.handle = handle
Service.prototype.tx = require('./srv-tx')
Service.prototype.decorate = require('./srv-methods')

const is_object = x => typeof x === 'object'
const is_query = x => x?.bind || Array.isArray(x) && !x.raw
const is_rest = x => typeof x === 'string' && x[0] === '/'
const _service_in = m => cds.linked(m).services?.[0]?.name
|| cds.error.expected `${{model:m}} to be a CSN with a single service definition`
const _nrm4skd = (method, path, data, headers) => {
  if (typeof method === 'object') return method
  if (typeof path !== 'object') return { method, path, data, headers }
  if (path.is_linked) return { method, entity: path, data, headers }
  return { method, data: path, headers: data }
}


exports = module.exports = Service
exports.Service = Service
