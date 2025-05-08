const cds = require ('../index'), { uuid } = cds.utils
const async_events = { succeeded:1, failed:1, done:1, commit:1 }
const locale = require('./../i18n/locale')
const { EventEmitter } = require('events')

/**
 * This is the base class for `cds.Events` and `cds.Requests`,
 * providing the transaction context nature to all instances.
 * Calling `srv.tx()` without args to start new transacions
 * creates direct instances of this base class.
 */
class EventContext {

  /** Creates a new instance that inherits from cds.context */
  static for (_,_as_root) {
    const ctx = new this (_)
    const base = cds.context
    if (base) {
      if (_as_root) ctx._set('_propagated', Object.create(base, { timestamp: { value: undefined } }))
      else {
        ctx._set('_propagated', base)
        if (!ctx.context) ctx._set('context', base.context) // all transaction handling works with root contexts
        if (!ctx.tx && base.tx) ctx.tx = base.tx
      }
    }
    return ctx
  }

  constructor(_={}) {
    Object.defineProperty (this, '_', { value:_, writable:true })
    Object.assign (this, _)
  }

  _set (property, value) {
    Object.defineProperty (this, property, { value, writable:true })
    return value
  }



  //
  // Emitting and listening to succeeded / failed / done events
  //

  get emitter() {
    return this.context._emitter || this.context._set('_emitter', new EventEmitter)
  }

  async emit (event,...args) {
    const emitter = this.context._emitter; if (!emitter) return
    if (event in async_events)
      for (const each of emitter.listeners(event))
        await each.call (this, ...args)
    else return emitter.emit (event,...args)
  }

  on (event, listener) {
    return this.emitter.on (event, listener.bind(this))
  }

  once (event, listener) {
    return this.emitter.once (event, listener.bind(this))
  }

  before (event, listener) {
    return this.emitter.prependListener (event, listener.bind(this))
  }


  //
  // The following properties are inherited from root contexts, if exist...
  //

  set context(c) { if (c) this._set('context', this._set('_propagated', c)) }
  get context() { return this }

  set id(id) {
    if (id) super.id = id
  }
  get id() {
    return super.id = this._propagated.id || this.headers[ 'x-correlation-id' ] || uuid()
  }

  set tenant(t) {
    if (t) super.tenant = t
  }
  get tenant() {
    return super.tenant = this._propagated.tenant || this._.req?.tenant
  }

  set user(u) {
    super.user = cds.User(u)
  }
  get user() {
    return super.user = this._propagated.user || cds.User (this._.req?.user)
  }

  set locale(l) {
    if (l) super.locale = super._locale = l
  }
  get locale() {
    return super.locale = this._propagated.locale || locale.from(this._.req) //||this.http?.req)
  }
  get _locale() {
    return super._locale = this._propagated._locale || locale.header(this._.req) //||this.http?.req)
    || this.hasOwnProperty('locale') && this.locale // eslint-disable-line no-prototype-builtins
  }

  get _features() {
    return super._features = this._propagated._features || Features.for (this._.req?.features || this.user.features)
  }
  get features() {
    return super.features = this._features || Features.none
  }
  set features(v) {
    super.features = Features.for(v) || Features.none
  }

  get model() {
    const m = this._propagated.model || this.http?.req.__model // IMPORTANT: Never use that anywhere else
    return this._set('model',m)
  }
  set model(m) {
    super.model = m
  }

  get timestamp() {
    return super.timestamp = this._propagated.timestamp || new Date
  }

  set headers(h) {
    if (h) super.headers = h
  }
  get headers() {
    // REVISIT: isn't "this._.req?.headers" deprecated? shouldn't it be "this.http?.req?.headers"?
    let headers = this._.req?.headers
    if (!headers) { headers={}
      const outer = this._propagated.headers
      if (outer) for (let each of EventContext.propagateHeaders) {
        if (each in outer) headers[each] = outer[each]
      }
    }
    return super.headers = headers
  }

  set http(rr) {
    if (!this._.req) Object.assign(this._, rr)
    super.http = rr
  }
  get http() {
    return super.http = this._propagated.http || this._.req && this._.res && { req:this._.req, res:this._.res }
  }


  /**
   * This sets an EventContext's / Message's / Request's tx object, i.e.
   * the service which this request is passed on for execution.
   * In response to that, the instance will be wired up to and inherit
   * context properties from tx.context.
   */
  set tx (tx) {
    Object.defineProperty (this,'tx',{value:tx}) //> allowed only once!
    const root = tx.context?.context
    if (root && root !== this) {
      if (!this.hasOwnProperty('context')) this.context = root // eslint-disable-line no-prototype-builtins
    }
  }
  get _tx() { return this.tx } // REVISIT: for compatibility to bade usages of req._tx
}


class Features {
  /**
   * Returns an instance of this class for different supported input variants to specify features:
   *
   * - an `array` of feature names of features to be enabled
   * - a `string` with a comma-separated list of feature names
   * - the string `'*'` to generically enable _all_ features
   * - an `object` with feature names as keys and boolean values true/false
   * - `null` or `undefined` or an _empty_ `string` or `array` or `object` to indicate no features
   *
   * Note that the returned instance is effectively an object that has all enabled feature
   * names as keys with the value true. In particualar, that means if the input is an object,
   * with some flags set to false, the returned instance will not have these keys at all.
   *
   * Hence, users of cds.context.features can simply check for the presence of a feature
   * with the like of `if ('foo' in cds.context.features)`...
   * @returns {Features}
   */
  static for (x) {
    if (x == null) return
    if (x === '*') return this.all
    if (Array.isArray(x)) ; //> go on below
    else if (typeof x === 'object') x = Object.keys(x).filter(k => x[k])
    else if (typeof x === 'string') x = x.split(',')
    if (x.length) return Object.assign (new this, x.reduce((o,f)=>{o[f]=true;return o},{}))
  }
  get given() { return true }
  get $hash() { let h = Object.keys(this).join(','); Object.defineProperty(this,'$hash',{value:h}); return h }
  includes(t) { return t in this }
  has(t) { return t in this }
  map(..._) { return Object.keys(this).map(..._) }
  find(filter) { for (let t in this) if (filter(t)) return t }
  some(filter) { for (let t in this) if (filter(t)) return true }
  every(filter) { for (let t in this) if (!filter(t)) return false }
  static all = new Proxy ({'*':true},{ has:() => true, get:(_,p) => p === '$hash' ? '*' : true })
  static none = new class none extends Features {
    get given(){ return false }
    get $hash(){ return '' }
  }
}

EventContext.prototype._set('_propagated', Object.seal({}))
EventContext.propagateHeaders = [ 'x-correlation-id' ]
module.exports = EventContext
