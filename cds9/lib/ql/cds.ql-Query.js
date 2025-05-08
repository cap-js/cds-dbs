const { AsyncResource } = require('async_hooks')
const cds = require('../index')
const cached = {}


class Query {

  static init() {
    const self = this, kind = self.name
    Object.defineProperty (this.prototype, 'kind', {value:kind})
    Object.defineProperty (this, 'name', {value:'cds.ql'})
    return Object.assign (function chimera (x,...etc) {
      if (!new.target) return self.call (x,...etc)
      let q = new self; if (x) q[kind] = x
      return q
    }, this.API)
  }

  /** @private to be implemented in subclassed*/
  static call() {}


  /**
   * The kind of query, as in CQN's SELECT, INSERT, UPDATE, DELETE, CREATE, DROP.
   */
  get kind() { return this.constructor.name }


  /**
   * Note to self: We can't use .as (alias) as that would conflict with
   * sub selects in columns, which in turn may has aliases in .as.
   */
  alias (a) {
    this._subject.as = a
    return this
  }

  /** Creates a derived instance that initially inherits all properties. */
  clone (_) {
    const kind = this.kind || Object.keys(this)[0]
    return {__proto__:this, [kind]: {__proto__:this[kind],..._} }
  }

  flat (q=this) {
    let x = q.kind || Object.keys(q)[0], y = q[x]
    let protos = [y]; for (let o=y; o.__proto__;) protos.push (o = o.__proto__)
    q[x] = Object.assign ({}, ...protos.reverse())
    if (y.columns) for (let c of y.columns) if (c.SELECT) (this||Query.prototype).flat(c)
    return q
  }

  /** Binds this query to be executed with the given service */
  bind (srv) {
    return Object.defineProperty (this,'_srv',{ value:srv, configurable:true, writable:true })
  }

  /** Turns all queries into Thenables which execute with primary db by default */
  get then() {
    const srv = this._srv || cds.db || cds.error `Can't execute query as no primary database is connected.`
    const q = new AsyncResource('await cds.query')
    return (r,e) => q.runInAsyncScope (srv.run, srv, this).then (r,e)
  }

  get _subject() { throw new Error('should be overridden in subclasses') }
  set _target(t) { this._set('_target',t) } // ensure non-enumerable

  /** @returns {ref:string[]} */
  _target4 (x,...y) {
    if (typeof x === 'string') {
      const r = cached[x] ??= cds.parse.path(x); this._target = {name:r.ref[0]}
      return { ...r, ref:[...r.ref] } // clone ref, as they may get modified
    } else if (x) {
      if (x.raw)    return this._target4 (y.length ? cds.parse.path(x,...y) : x[0])
      if (x.ref)    return this._target = {name:x.ref[0]}, x
      if (x.name)   return this._target = x, {ref:[x.name]}
      if (x.SELECT) return this._target = x
      if (x.SET)    return this._target = x
    }
    throw this._expected `${{target:x}} to be a CSN entity, an entity name or path, a {ref}, or a subquery`
  }

  _expected (...args) {
    return cds.error.expected (...args)
  }

  _assign (...aspects) {
    Object.assign (this[this.kind], ...aspects)
    return this
  }

  _add (property, values) {
    const $ = this[this.kind], pd = Reflect.getOwnPropertyDescriptor ($,property)
    $[property] = !pd?.value ? values : [ ...pd.value, ...values ]
    return this
  }

  _set (property, value) {
    Object.defineProperty (this, property, { value, configurable:true, writable:true })
    return value
  }

  valueOf (prelude = this.kind) {
    return `${prelude} ${_name(this._target.name)} `
  }
}

const _name = cds.env.sql.names === 'quoted' ? n =>`"${n}"` : n => n.replace(/[.:]/g,'_')
const _no_target = ()=>{ throw cds.error `Queries don't have a 'target' property. Use 'req.target' instead.` }
Object.defineProperty (Query.prototype, 'target', { get:_no_target, set:_no_target })
module.exports = Query
