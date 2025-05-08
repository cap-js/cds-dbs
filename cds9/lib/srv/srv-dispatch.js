const cds = require ('../index')

/**
 * The default implementation of the `srv.dispatch(req)` ensures everything
 * is prepared before calling `srv.handle(req)`
 * @typedef {import('./cds.Service')} Service
 * @typedef {import('../req/request')} Request
 * @this {Service}
 * @param {Request} req
 * @returns {Promise} resolving to the outcome/return value of last .on handler
 */
exports.dispatch = async function dispatch (req) { //NOSONAR

  // Ensure we are in a proper transaction
  if (!this.context) return this.run (tx => tx.dispatch(req))
  if (!req.tx) req.tx = this // `this` is a tx from now on...

  // Handle batches of queries
  if (_is_array(req.query)) return Promise.all (req.query.map (
    q => this.dispatch ({ query:q, context: req.context, __proto__:req })
  ))

  // Ensure inferred target and fqns
  _ensure_target (this,req)

  // Actually handle the request
  return this.handle (req)
}


/**
 * The default implementation of the `srv.handle(req)` method dispatches
 * requests through registered event handlers.
 * Subclasses should overload this method instead of `srv.dispatch`.
 * @param {Request} req
 * @this {Service}
 */
exports.handle = async function handle (req) {
  const srv=this; let handlers //...

  // ._initial handlers run in sequence
  handlers = this.handlers._initial.filter (h => h.for(req))
  if (handlers.length) {
    for (const each of handlers) await each.handler.call (this,req)
    if (req.errors) throw req.reject()
  }

  // .before handlers run in parallel
  handlers = this.handlers.before.filter (h => h.for(req))
  if (handlers.length) {
    await Promise.all (handlers.map (each => each.handler.call (this,req)))
    if (req.errors) throw req.reject()
  }

  // .on handlers run in parallel for async events, and as interceptors stack for sync requests
  handlers = this.handlers.on.filter (h => h.for(req))
  if (handlers.length) {
    if (!req.reply) await Promise.all (handlers.map (each => each.handler.call (this,req,_dummy)))
    else await async function next (r=req) { //> handlers may pass a new req object into next()
      const each = handlers.shift(); if (!each) return //> unhandled silently
      const x = await each.handler.call (srv,r,next)
      if (x !== undefined)      return r.reply(x)
      if (r.results)            return r.results
    }()
    if (req.errors) throw req.reject()
  }
  else if (req.query) throw _unhandled (this,req)

  // .after handlers run in parallel
  handlers = this.handlers.after.filter (h => h.for(req))
  if (handlers.length) {
    const results = req.event === 'READ' && !_is_array(req.results) ? (req.results == null ? [] : [req.results]) : req.results
    await Promise.all (handlers.map (each => each.handler.call (this, results, req)))
    if (req.errors) throw req.reject()
  }

  return req.results //> done
}


const _is_array = Array.isArray
const _dummy = ()=>{} // REVISIT: required for some messaging tests which obviously still expect and call next()

const _ensure_target = (srv,req) => {

  // Requests with query
  if (typeof req.query === 'object') {
    const q = req.query = cds.ql(req.query)
    if (!q._subject) return // REVISIT: this is for attic code which sends strange req.query = {}
    if (!q._srv) q.bind (srv) // ensure req.query to be an instance of cds.ql.Query
    if (!req.target) {
      if (srv.namespace && q._subject.ref) _ensure_fqn (q._subject.ref,0, srv)
      req.target = cds.infer.target(q)
    }
    if (q._target !== req.target) q._target = req.target
  }

  // Requests without query
  else if (!req.target && srv.namespace) {
    let p = req._.path || req._.entity
    if (p) _ensure_fqn (req,'path', srv, p[0] === '/' ? p.slice(1) : p)
  }
}

const _ensure_fqn = (x,p,srv, name = x[p]) => {
  if (name.id) return _ensure_fqn (name,'id', srv, name.id)
  if (srv.model) {
    if (name in srv.model.definitions) return // already an fqn
    if (name in srv.entities) return x[p] = srv.entities[name].name
  }
  if (srv.isDatabaseService) return // db services allow unknown entities, e.g. 'sqlite.schema'
  if (!name.startsWith(srv.namespace+'.')) x[p] = `${srv.namespace}.${name}`
}

const _unhandled = (srv,req) => {
  const event = req.event + (req.path ? ' ' + req.path : '')
  return req.reject (501, `Service "${srv.name}" has no handler for "${event}".`)
}
