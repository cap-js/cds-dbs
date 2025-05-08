const cds = require('..')

class EventHandlers {

  /** @type {EventHandler[]} */ _initial = []
  /** @type {EventHandler[]} */ before = []
  /** @type {EventHandler[]} */ on = []
  /** @type {EventHandler[]} */ after = []
  /** @type {EventHandler[]} */ _error = []

  /** @this {Service} */
  prepend (fn) {
    const {handlers} = this, _new = this.handlers = new EventHandlers
    const x = fn.call (this,this) // NOTE: we need the doubled await to compensate usages of srv.prepend() with missing awaits !!!
    if (x?.then) throw cds.error `srv.prepend() doesn't accept asynchronous functions anymore`
    for (let each in _new) if (_new[each].length) handlers[each].unshift(..._new[each])
    this.handlers = handlers
    return this
  }

  //--------------------------------------------------------------------------
  /** Registers event handlers. This is the central method to register handlers,
   * used by all respective public API methods, i.e. .on/before/after/reject.
   * @import Service from './cds.Service'
   * @import Request from '../req/request'
   * @param {Service} srv
   * @param {'on'|'before'|'after'} phase
   * @param {string|string[]} event
   * @param {string|string[]} path
   * @param {(req:Request)=>{}} handler
   */
  register (srv, phase, event, path, handler) {

    if (!handler) [ handler, path ] = [ path, '*' ] // argument path is optional
    else if (path === undefined) cds.error.expected `${{path}} to be a string or csn definition`
    if (typeof handler !== 'function') cds.error.expected `${{handler}} to be a function`
    if (handler._is_stub) {
      cds.log().warn (`\n
        WARNING: You are trying to register a frameworks-generated stub method for
        custom action/function '${event}' in implementation of service '${srv.name}'.
        We're ignoring that as we already registered the according handler.
        Please fix your implementation, i.e., just don't register that handler.
      `)
      return srv
    }

    // Canonicalize event argument
    if (!event || event === '*') event = undefined
    else if (is_array(event)) {
      for (let each of event) this.register (srv, phase, each, path, handler)
      return srv
    }
    else if (event === 'SAVE' || event === 'WRITE') {
      for (let each of ['CREATE','UPSERT','UPDATE']) this.register (srv, phase, each, path, handler)
      return srv
    }
    else if (phase === 'after' && ( event === 'each'    //> srv.after ('each', Book, b => ...)    // event 'each' => READ each
      || event === 'READ' && path?.is_singular          //> srv.after ('READ', Book, b => ...)    // Book is a singular def from cds-typer
      || event === 'READ' && /^\(?each\b/.test(handler) //> srv.after ('READ', Book, each => ...) // handler's first param is named 'each'
    )) {
      event = 'READ' // override event='each' to 'READ'
      const h=handler; handler = (rows,req) => is_array(rows) ? rows.forEach (r => h(r,req)) : rows && h(rows,req)
    }
    else if (typeof event === 'object') {
      // extract action name from an action definition's fqn
      event = event.name && /[^.]+$/.exec(event.name)[0] || cds.error.expected `${{event}} to be a string or an action's CSN definition`
    }
    else event = events[event] || event

    // Canonicalize path argument
    if (!path || path === '*') path = undefined
    else if (is_array(path)) {
      for (let each of path) this.register (srv, phase, event, each, handler)
      return srv
    }
    else if (typeof path === 'object') {
      path = path.name || cds.error.expected `${{path}} to be a string or an entity's CSN definition`
    }
    else if (typeof path === 'string') {
      if (!path.startsWith(srv.name+'.')) path = `${srv.name}.${path}`
    }

    // Finally register with a filter function to match requests to be handled
    const handlers = event === 'error' ? this._error : handler._initial ? this._initial : this[phase] // REVISIT: remove _initial handlers
    handlers.push (new EventHandler (phase, event, path, handler))

    if (phase === 'on') cds.emit('subscribe',srv,event) //> inform messaging service
    return srv
  }
}


class EventHandler {
  constructor (phase, event, path, handler) {
    const h = { [phase]: event || '*' }
    if (path) h.path = path
    h.handler = Object.defineProperty (handler, '_initial', {enumerable:false})
    Object.defineProperty (h, 'for', {value: this.for(event,path) })
    return h
  }
  /** Factory for the actual filter method this.for, assigned above */
  for (event, path) {
    if (event && path) return req => event === req.event && (path === req.path || path === req.entity)
    if (event) return req => event === req.event
    if (path) return req => path === req.path || path === req.entity
    else return () => true
  }
}


const is_array = Array.isArray
const events = {
  SELECT: 'READ',
  GET: 'READ',
  PUT: 'UPDATE',
  POST: 'CREATE',
  INSERT: 'CREATE',
}

module.exports = EventHandlers
