const _proxy = Symbol('_proxy')

class any { is (kind) { return this.kind === kind || kind === 'any' }

  constructor(...aspects) { Object.assign (this,...aspects) }
  set name(n) { this.set('name', n, false) }
  set kind(k) { this.set('kind', k, true) }
  get kind() { return this.set('kind', this.parent ? 'element' : 'type') }
  toString(){ return !this.type ? this : this.type.startsWith('cds.') ? this.type.slice(4) : this.type }

  own (property, ifAbsent) {
    const pd = Reflect.getOwnPropertyDescriptor (this, property)
    if (pd) return pd.value //|| pd.get(this)
    if (ifAbsent) return this.set (property, ifAbsent())
  }

  set (property, value, enumerable = false) {
    Reflect.defineProperty (this, property, { value, enumerable, writable:1, configurable:1 })
    return value
  }

  toJSON() {
    const o={}; for (let p in this) o[p] = this[p]
    return o
  }

  dataIn (d, prefix='') { return d[prefix + this.name] }
}

class aspect extends any { is(kind) { return kind === 'aspect' || super.is(kind) }}
class type extends any { is(kind) { return kind === 'type' || super.is(kind) }
  toJSON() {
    return this.own('type') ? {...this} : super.toJSON()
  }
}

  class scalar extends type {}

    class boolean extends scalar {}
      class Boolean extends boolean {}

    class string extends scalar {
      toString(){
        return this.length ? `${super.toString()}(${this.length})` : super.toString()
      }
    }
      class UUID extends string {
        toString(){ return 'UUID' }
      }
      class String extends string {}
        class LargeString extends String {}
      class Binary extends string {}
        class LargeBinary extends Binary {}
        class Vector extends Binary {}

    class number extends scalar {}
      class Integer extends number {}
        class UInt8 extends Integer {}
        class Int16 extends Integer {}
        class Int32 extends Integer {}
        class Int64 extends Integer {}
        class Double extends number {}
        class Decimal extends number {
          toString(){
            return this.precision ? this.scale ? `Decimal(${this.precision},${this.scale})` : `Decimal(${this.precision})` : 'Decimal'
          }
        }

    class date extends scalar {}
      class Date extends date {}
      class Time extends date {}
      class DateTime extends date {}
        class Timestamp extends DateTime {}

  class array extends type {
    toString(){ return 'array of ' + this.items.toString() }
    is(kind) { return kind === 'array' || super.is(kind) }
  }
  class struct extends type {
    toString(){
      const elements = []
      for (let each in this.elements) elements.push(each)
      return `{ ${elements.join(', ')} }`
    }
    is(kind) { return kind === 'struct' || super.is(kind) }

    /**
     * Gets the foreign key data for a given managed association from inbound data
     * in structured form.
     *
     * @example
     * let { Books } = srv.entities
     * let { author } = Books.elements
     * let book = { // inbound data, e.g. from req.data
     *   title: 'Foo',
     *   author_ID: 111
     * }
     * let value = author.dataIn(book)
     * //> { ID: 111 }
     *
     * Actually this works for all struct-like elements, i.e., which's definitions
     * have .elements or .foreignKeys. Could be added to cds.struct/cds.Association.
     */
    dataIn (d, prefix='', _skip_root) {
      const key = prefix + this.name; if (!_skip_root && key in d) return d[key]
      const elements = this.elements || this.foreignKeys
      const nested={}, key_ = _skip_root ? '' : key+'_'
      let any; for (let e in elements) {
        const v = elements[e] .dataIn (d,key_)
        if (v !== undefined) nested[any=e] = v
      }
      if (any) return !prefix && d._hull ? d._hull[key] = nested : nested
    }

    /**
     * Returns a Proxy for provided data which adds getters to return values
     * for struct elements (including Associations) in structured form.
     *
     * @example
     * let { Books } = m.entities
     * let data = Books.data ({
     *   author: {ID:111},
     *   genre_ID: 22
     * })
     * console.log ('author:', data.author) //> { ID: 111 }
     * console.log ('genre:', data.genre)  //> { ID: 22 }
     */
    data (d) {
      if (_proxy in d) return d[_proxy] //> use cached proxy, if exists

      // hull to cache calculated values without polluting original input
      const _hull = {__proto__:d}

      // allow external code to access _hull
      Object.defineProperty (_hull, '_hull', {value:_hull})

      // proxy calls def.dataIn() for defined elements, fallback hull[p]
      const {elements} = this, proxy = new Proxy (d, {
        get: (_,p) => elements[p]?.dataIn?.(_hull) || _hull[p],
      })

      // cache proxy with original data
      Object.defineProperty (d, _proxy, {value:proxy})

      return proxy
    }
  }

  class Map extends struct {
    get elements() { return this.set('elements', new LinkedDefinitions) }
  }

class context extends any {}
class service extends context {

  get entities()   { return this.set('entities', this._collect (d => d.kind === 'entity')) }
  get types()      { return this.set('types',    this._collect (d => d.kind === 'type' || !d.kind)) }
  get events()     { return this.set('events',   this._collect (d => d.kind === 'event')) }
  get actions()    { return this.set('actions',  this._collect (d => d.kind === 'action' || d.kind === 'function')) }
  get operations() { return this.set('actions',  this._collect (d => d.kind === 'action' || d.kind === 'function')) }

  /** @private */ _collect (filter) {
    const defs = this.model?.definitions, prefix = this.name+'.', dict = new LinkedDefinitions
    for (let each in defs) {
      let d = defs[each]
      if (d._service === this && filter(d)) dict[each.slice(prefix.length)] = d
    }
    return dict
  }

  get protocols()  { return this.set('protocols',  service.protocols.for(this)) }
  static get protocols() { return this._lazy ('protocols', require('../srv/protocols')) }
  static get bindings() { return this._lazy ('bindings', require('../srv/bindings')) }
  static get factory() { return this._lazy ('factory', require('../srv/factory')) }
  static endpoints4(..._) { return this.protocols.endpoints4(..._) }
  static path4(..._) { return this.protocols.path4(..._) }

  /** @private @type <T> (p,v:T) => T */ static _lazy (p,v) {
    Reflect.defineProperty (this,p,{value:v})
    return v
  }
}
class action extends any {}
class event extends aspect {}


class LinkedDefinitions {
  *[Symbol.iterator](){ for (let e in this) yield this[e] }
}


module.exports = {

  LinkedDefinitions,

  any, type, aspect, struct, array, Map,
  scalar, boolean, string, number, date,
  service, event, action, function: action,
  context,

  UUID, Boolean, String,
  Integer, UInt8, Int16, Int32, Int64,

  Double, Decimal,
  Date, Time, DateTime, Timestamp,
  Binary, Vector, LargeBinary, LargeString,

  /**
   * Allows to mixin functions or properties to several equally named builtin classes
   * @example
   * cds.builtin.classes.mixin (
   *  	class any { foo(){} },
   *  	class entity { bar(){} }
   * )
   */
  mixin(...classes) {
    const extend = require('../utils/extend')
    for (let each of classes) {
      const clazz = this[each.name]
      if (!clazz) throw new Error(`unknown class '${each.name}'`)
      extend(clazz).with(each)
    }
  },
}
