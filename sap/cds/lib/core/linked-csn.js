const { types, classes } = require('./types')
const { LinkedDefinitions, any } = classes
const _kinds = {
  annotation:1,
  context:1,
  service:1,
  entity:1,
  event:1,
  action:1,
  function:1,
}


class LinkedCSN {

  constructor (x,...etc) {

    if (x.raw) x = require('../index').compile(String.raw(x,...etc)) //> for convenience in repl
    else if (typeof x === 'string') x = require('../index').compile(x) //> for convenience in repl
    const defs = x.definitions = _iterable (x.definitions||{})
    for (let d in defs) _link (defs[d],d)
    return Object.setPrototypeOf (x, new.target.prototype)

    function _link (d, name, parent, _kind) {
      if (name)     _set (d,'name', name)
      if (parent) { _set (d,'parent', parent); if (!d.kind) _set (d,'kind', _kind || 'element') }
      if (d.kind === 'service') {
        for (let e in defs) if (e.startsWith(name+'.')) _set (defs[e],'_service',d)
        _set (d,'model',x) //> required for getters like service.entities
      }
      else if (d.target)          _set (d,'_target', _target(d.target) || _link (d.target,name,d))
      else if (d.projection)      _set (d,'query', {SELECT:d.projection})
      else if (d.returns)         _link (d.returns)
      else if (d.items)           _link (d.items)
      for (let e in _iterable(d.elements)) _link (d.elements[e],e,d)
      for (let a in _iterable(d.actions))  _link (d.actions[a],a,d,'action')
      for (let p in _iterable(d.params))   _link (d.params[p],p,d,'param')
      let p = (                   //> determine the definition's prototype ...
        d.type            ? _typeof (d.type) || _resolve (d.type) :
        d.query           ? _infer (d.query,x) || types.entity :
        d.kind in _kinds  ? types[d.kind] :
        d.elements        ? types.struct :
        d.items           ? types.array :
        /* else: */         types.any
      )
      if (d.kind === 'entity') {
        if (p.actions && !d.actions) _set (d,'actions',undefined) //> don't propagate .actions
        if (p.params && !d.params)   _set (d,'params',undefined)  //> don't propagate .params
        if (d.elements?.localized)   _set (d,'texts', defs[d.elements.localized.target])
      } else if (d.kind === 'element') {
        if (p.key && !d.key) _set (d,'key',undefined)  //> don't propagate .key
      }
      try { return Object.setPrototypeOf(d,p) }            //> link d to resolved proto
      catch(e) {                                          //> cyclic proto error
        let msg = d.name; for (; p && p.name; p = p.__proto__) msg += ' > '+p.name
        let $ = d.$location; if ($) msg += `\n    at ${$.file}:${$.line}:${$.col}`
        e.message += `: ${msg}`; throw e
      }
    }
    function _resolve(x) { return defs[x] || _builtin(x) || (defs[x] = _unresolved(x)) }
    function _target(x) { return typeof x === 'string' && _resolve(x) }
    function _typeof({ref}) { if (ref) {
      let i=0, n=ref.length, t=defs[ref[0]]
      for (;;) {
        if (++i === n) return t
        if (t.items) t = t.items
        if (t.target) t = defs[t.target]
        if (t.elements) t = t.elements[ref[i]]
        if (!t) return
      }
    }}
  }

  *each (x, defs=this.definitions) {
    const pick=_is(x); for (let d in defs) if (pick(defs[d])) yield defs[d]
  }
  find (x, defs=this.definitions) {
    const pick=_is(x); for (let d in defs) if (pick(defs[d])) return defs[d]
  }
  all (x, defs=this.definitions) {
    return Object.values(defs).filter(_is(x))
  }

  foreach (x, v, defs=this.definitions) {
    const y=_is(x), visit = typeof v !== 'function' ? x : (d,n,p) => y(d) && v(d,n,p)
    for (let name in defs) visit (defs[name],name)
    return this
  }

  forall (x, v, defs=this.definitions) {
    const y=_is(x), visit = typeof v !== 'function' ? x : (d,n,p) => y(d) && v(d,n,p)
    ;(function _recurse (defs,parent) { for (let name in defs) {
      const d = defs[name]; visit (d,name,parent); let y //...
      if ((y = _own(d,'elements'))) _recurse (y,d)
      if ((y = _own(d,'actions'))) _recurse (y,d)
      if ((y = _own(d,'target')) && y.elements) _recurse (y.elements,y)
    }})(defs)
    return this
  }

  childrenOf (x, filter = ()=>true, defs = this.definitions) {
    const children = namespace => !namespace ? children : this.childrenOf (namespace,filter)
    const prefix = !x ? '' : typeof x === 'string' ? x+'.' : ((x = x.namespace || x.name)) ? x+'.' : ''
    for (let fqn in defs) if (fqn.startsWith(prefix)) {
      const d = defs[fqn]; if (!filter(d)) continue
      else children[fqn.slice(prefix.length)] = d
    }
    return _iterable (children)
  }

  get exports()  { return this.set ('exports',  this.childrenOf (this)) }
  get entities() { return this.set ('entities', this.childrenOf (this, d => d.is_entity)) }
  get services() {
    let srvs = this.all (d => d.is_service)
    for (let s of srvs) Object.defineProperty (srvs, s.name, {value:s})
    return this.set ('services', srvs)
  }

  /** A common cache for all kinds of things -> keeps the models clean */
  get _cached() { return this.set ('_cached', {}) }
}


const _iterable = defs => defs && Object.setPrototypeOf (defs, LinkedDefinitions.prototype)
const _unresolved = (x, unknown = types.any) => ({ name:x, __proto__:unknown, _unresolved:true })
const _builtin = x => types[x] || x.startsWith?.('cds.hana.') && types.any
const _infer = require('../ql/cds.ql-infer')
const _set = (o,p,v,e=false) => Object.defineProperty (o,p,{ value:v, enumerable:e, configurable:1, writable:1 })
const _own = (o,p) => { const pd = Reflect.getOwnPropertyDescriptor(o,p); return pd && pd.value }
const _is = x => {
  if (typeof x === 'string')  return x === 'any' ? ()=>true : d => d.is(x)
  if (typeof x === 'function') return x.prototype?.is_linked ? d => d instanceof x : x
  throw new Error ('invalid filter for model reflection: '+ x)
}


_set (LinkedCSN.prototype, 'set', any.prototype.set) //> inherit this.set() from any
LinkedCSN.prototype.set('is_linked', true)
any.prototype.set('is_linked', true)


/** @returns {LinkedCSN} */
const linked = x => !x || x.is_linked ? x : new LinkedCSN (x)
exports = module.exports = linked
exports.LinkedDefinitions = LinkedDefinitions
exports.LinkedCSN = LinkedCSN
exports.types = types
exports.classes = classes
