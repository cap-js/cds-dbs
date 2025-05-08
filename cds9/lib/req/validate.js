const cds = require('..')

/** Validates given input data against a request target definition.
 * @param {entity} target the linked definition to check against, usually an entity definition
 * @returns {Error[]|undefined} an array of errors or undefined if no errors occurred
 */
const conf = module.exports = exports = function validate (data, target, options={}) {
  const vc = new Validation (data, target, options)
  target.validate (data, null, vc)
  return vc.errors
}


/** Instances represent single validations and are mainly used to record errors during validation. */
class Validation {

  constructor (data, target, options={}) {
    this.data = data
    this.target = target
    this.protocol = options.protocol
    this.options = options
    this.insert = options.insert ?? options.mandatories
    this.rejectIgnore = options.rejectIgnore
    this.cleanse = options.cleanse !== false
  }

  error (code, path, leaf, val, ...args) {
    const err = (this.errors ??= new ValidationErrors).add (code)
    if (this.options.path) path = [ this.options.path, ...path ] // e.g. used to prefic 'in/' for actions
    if (path) err.target = (!leaf ? path : path.concat(leaf)).reduce?.((p,n)=> (
      n?.row ? p + this.filter4(n) :          //> some/entity(ID=1)...
      typeof n === 'number' ? p + `[${n}]` :  //> some/array[1]...
      p && n ? p+'/'+n : n                    //> some/element...
    ),'')
    if (val !== undefined) err.args = [ val, ...args ]
    return err
  }

  filter4 ({ def, row, index }) {
    if (this.target.kind in { 'action': 1, 'function': 1 }) return '' //> no filter for operations
    const entity = def._target || def, filter=[]
    for (let k in entity.keys) {
      let v = row[k]
      if (v === undefined) if (k === 'IsActiveEntity') v = false; else continue
      else if (typeof v === 'string' && !entity.elements[k].isUUID || entity.elements[k]['@odata.Type'] === 'Edm.String') v = `'${v}'`
      filter.push (`${k}=${v}`)
    }
    return filter.length ? `(${filter})` : `[${index}]`
  }

  unknown(e,d,input) {
    if (this.protocol === 'odata' && e.match(/^\w*@\w+\.\w+$/)) return delete input[e] //> skip all annotations, like @odata.Type (according to OData spec annotations contain an "@" and a ".")
    d['@open'] || cds.error (`Property "${e}" does not exist in ${d.name}`, {status:400})
  }
}


/** ValidationErrors avoid expensive creation of stack traces */
class ValidationErrors extends Array {
  add (error) {
    const err = Object.create (ValidationErrors.proto)
    err.message = error
    this.push (err)
    return err
  }
  static proto = Object.create (Error.prototype, {
    message: { writable:true, configurable:true },
    stack: { configurable:true, get() { return this.message },
      set(v) { Object.defineProperty (this, 'stack', { value:v, writable:true, configurable:true }) },
    },
    status: { value: 400 },
  })
}
exports.ValidationErrors = ValidationErrors


/** Adding basic validation capabilities to linked definitions. */
const $any = class any {

  /**
   * Central method for validating input data against CSN definitions.
   * @param {any} value the input value to validate
   * @param {Array} path the path prefix to use for error messages
   * @param {Validation} ctx the request object used to record errors
   */
  validate (value, path, ctx) {
    this.check_asserts (value, path, ctx)
  }

  /**
   * Checks the type of provided input values as well as @asserts specified.
   * On first call, it constructs an optimized instance-specific override of
   * this method for subsequent usages, with statically determined checks.
   */
  check_asserts (val, path, /** @type {Validation} */ ctx) {
    // IMPORTANT: We need to use this.own() here as elements derived from reuse
    // definitions or from elements of base entities might have different asserts
    // than inherited ones.
    const check_asserts = this.own('_check_asserts', () => {
      const asserts = []
      const type_check = conf.strict && this.strict_check || this.type_check
      if (type_check) {
        asserts.push ((v,p,ctx) => v == null || type_check(v) || ctx.error ('ASSERT_DATA_TYPE', p, this.name, v, this ))
      }
      if (this._is_mandatory()) {
        asserts.push ((v,p,ctx) => v != null && v.trim?.() !== '' || ctx.error ('ASSERT_NOT_NULL', p, this.name, v)) // ASSERT_NOT_NULL is misleading -> should be ASSERT_REQUIRED
      }
      if (this['@assert.format']) {
        const format = new RegExp(this['@assert.format'],'u')
        asserts.push ((v,p,ctx) => v == null || format.test(v) || ctx.error ('ASSERT_FORMAT', p, this.name, v, format))
      }
      if (this['@assert.range'] && !this.enum) {
        const [ min, max ] = this['@assert.range']
        if (min['='] === '_') min.val = -Infinity
        if (max['='] === '_') max.val = +Infinity
        asserts.push (
          min.val !== undefined && max.val !== undefined ? (v,p,ctx) => v == null || min.val < v && v < max.val || ctx.error ('ASSERT_RANGE', p, this.name, v, '>'+min.val, '<'+max.val) :
          min.val !== undefined ? (v,p,ctx) => v == null || min.val < v && v <= max || ctx.error ('ASSERT_RANGE', p, this.name, v, '>'+min.val, max) :
          max.val !== undefined ? (v,p,ctx) => v == null || min <= v && v < max.val || ctx.error ('ASSERT_RANGE', p, this.name, v, min, '<'+max.val) :
          (v,p,ctx) => v == null || min <= v && v <= max || ctx.error ('ASSERT_RANGE', p, this.name, v, min, max)
        )
      }
      if (this['@assert.enum'] || this['@assert.range'] && this.enum) {
        const vals = Object.entries(this.enum).map(([k,v]) => 'val' in v ? v.val : k)
        const enums = vals.reduce((a,v) => (a[v]=true, a),{})
        asserts.push ((v,p,ctx) => v == null || v in enums || vals.some(x => x == v) || ctx.error ('ASSERT_ENUM', p, this.name, typeof v === 'string' ? `"${v}"` : v, vals.join(', ')))
      }
      if (!asserts.length) return ()=>{} // nothing to do
      return (v,p,ctx) => asserts.forEach (a => a(v,p,ctx))
    })
    return check_asserts (val, path, ctx)
  }

  _is_mandatory (d=this) {
    return d.own('_mandatory', ()=> {
      if (d._is_readonly()) return false // readonly annotations have precedence over mandatory ones
      if (d['@mandatory'] || d['@Common.FieldControl']?.['#'] === 'Mandatory') {
        const q = d.parent?.query?.SELECT
        if (!q) return true // it's a regular entity's element marked as mandatory
        if (!q.from?.ref) return false // join or union -> elements can't be mandatory
        const c = q.columns?.find (c => alias4(c) === d.name)
        if (!c) return true // * or foo.* -> can't tell whether d is joined
        if (!c.ref) return false // calculated fields aren't mandatory
        if (c.ref.length === 1) return true // SELECT from Foo { foo }
        if (c.ref.length === 2 && c.ref[0] === alias4(q.from)) return true // SELECT from Foo as f { f.foo }
        else return false // joined field which can't be mandatory, e.g. SELECT from Books { author.name as author }
        function alias4 (x) { return x.as || x.ref?.at(-1) }
      }
      if (d.notNull && !d.default && (d.parent?.kind === 'action' || d.parent?.kind === 'function')) return true // only for action/function params
      else return false
    })
  }

  _is_readonly (d=this) {
    return d.own('_readonly', ()=> {
      if (d['@readonly'])                                   return true
      if (d['@cds.on.insert'])                              return true
      if (d['@cds.on.update'])                              return true
      if (d['@Core.Computed'])                              return true
      if (d['@Common.FieldControl']?.['#'] === 'ReadOnly')  return true
      else return false
    })
  }

  /**
   * Checks if a nested row of a deep update is in turn to be inserted or updated.
   * This is the case if the row date does not contain all primary key elements of the target entity.
   */
  _is_insert (row) {
    // IMPORTANT: We need to use this.own() here as derived entities might have
    // different keys and thus different insert checks.
    const _is_insert = this.own('__is_insert', () => {
      const entity = this._target || this
      let keys = Object.keys (entity.keys||{})
      keys = keys.filter(k => !entity.elements[k].virtual)
      if (!keys.length) return ()=> true
      else return data => typeof data === 'object' && !keys.every(k => k in data)
    })
    return _is_insert(row)
  }

  _required (elements) {
    // IMPORTANT: We need to use this.own() here as derived entities might have
    // different elements or elements with different annotations than base entitites.
    return this.own('__required', ()=> Object.values(elements).filter(this._is_mandatory))
  }

  /** Forward declaration for universal CSN */
  get $struct() { return this['@odata.foreignKey4'] }
}

/** Structs iterate over their elements to validate them. */
class struct extends $any {
  validate (data, path, /** @type {Validation} */ ctx, elements = this.elements, skip={}) {
    if (data == null) return
    const path_ = !path ? [] : [...path, this.name]; if (path?.row) path_.push({...path})
    if (typeof data !== 'object') return ctx.error ('ASSERT_DATA_TYPE', path_, this.name, data, this.target)
    // check for required elements in case of inserts -- note: null values are handled in the payload loop below
    if (ctx.insert || data && path_.length && this._is_insert(data)) for (let each of this._required (elements)) {
      if (each.name in data) continue // got value for required element
      if (each.name in skip) continue // skip uplinks in deep inserts -> see Composition.validate()
      if (each.$struct in data) continue // got struct for flattened element/fk, e.g. {author:{ID:1}}
      if (each.elements || each.foreignKeys) continue // skip struct-likes as we check flat payloads above, and deep payloads via struct.validate()
      if (each.isAssociation) continue // unmanaged associations are always ignored (no value like)
      else ctx.error ('ASSERT_NOT_NULL', path_, each.name) // ASSERT_NOT_NULL should be ASSERT_REQUIRED
    }
    // check values of given data
    for (let each in data) { // will work for structured payloads as well as flattened ones with universal CSN
      let /** @type {$any} */ d = elements[each]
      if (!d || (d['@cds.api.ignore'] && ctx.rejectIgnore)) ctx.unknown (each, this, data)
      else if (ctx.cleanse && d._is_readonly() && !d.key) delete data[each]
      // @Core.Immutable processed only for root, children are handled when knowing db state
      else if (ctx.cleanse && d['@Core.Immutable'] && !ctx.insert && !path) delete data[each]
      else if (d['@cds.validate'] !== false) d.validate (data[each], path_, ctx)
    }
  }
}

/** Array definitions validate the entries of an array against their items definition. */
class array extends $any {
  validate (data, path, /** @type {Validation} */ ctx) {
    if (data == null) return super.validate (data, path, ctx)
    if (!Array.isArray(data)) return ctx.error ('ASSERT_ARRAY', path, this.name)
    const path_ = path?.concat(this.name)
    const /** @type {$any} */ items = { __proto__:this.items, name: undefined }
    data.forEach ((entry,i) => items.validate (entry, path_.concat(i), ctx))
  }
}

/** Entities support both as input: single records as well as arrays of which. */
class entity extends struct {
  validate (data, path, ctx, ...more) {
    const _path4 = !path ? ()=>path : (row,i) => ({__proto__:path, index:i, row, def:this})
    if (!Array.isArray(data)) return super.validate (data, _path4(data), ctx, ...more)
    return data.forEach ((row,i) => super.validate (row, _path4(row,i), ctx, ...more))
  }
}

/** Actions are struct-like, with their parameters as elements to validate. */
class action extends struct {
  validate (data, path, ctx) {
    super.validate (data, path, ctx, this.params || {})
  }

  _is_mandatory(e) { return e.notNull && !e.default } // params
}

/** Managed associations are struct-like, with foreign keys as elements to validate. */
class Association extends struct {
  validate (data, path, ctx) {
    if (this.foreignKeys) super.validate (data, path, ctx, this.foreignKeys)
  }
}

/** Compositions are like nested entities, validating deep input against their target entity definitions. */
class Composition extends entity {
  validate (data, path, ctx) { if (!data) return
    const _validate = this.own('_validate', () => {
      const elements = this._target.elements
      const uplinks = {} // statically determine the uplinks for this composition
      if (this.on) for (let {ref} of this.on) if (ref?.[0] === this.name) {
        const fk = ref[1], fk_ = fk+'_'; uplinks[fk] = true
        for (let e in elements) if (e.startsWith(fk_)) uplinks[e] = true
      }
      return (data, path, ctx) => super.validate (data, path, ctx, elements, uplinks)
    })
    _validate (data, path, ctx)
  }
}


// Type checks ---------------------------------------------------------------

$any.prototype.type_check = undefined

/**
 * This getter constructs and returns a type check function for the declared precision and scale.
 * Precision is the total number of digits, scale the number of digits after the decimal point.
 */
class Decimal extends $any { get type_check() {
  const { precision:p, scale:s } = this, rx = RegExp (
    !p ? `^[+-]?\\d+(?:\\.\\d+)?$` :
    !s ? `^[+-]?\\d{1,${p}}$` :
    p === s ? `^[+-]?0(?:\\.\\d{1,${s}})?$` :
    /* p,s */ `^[+-]?\\d{1,${p-s}}(?:\\.\\d{1,${s}})?$`
  )
  return v => rx.test(v)
}}

class string extends $any { get type_check() {
  const { length:l } = this; return l
    ? v => typeof v === 'string' && v.length <= l
    : v => typeof v === 'string'
}}

const {Readable} = require('stream')
const _range_check = (range, min=-range) => v => min <= v && v < range
const _regex_check = (rx) => v => rx.test(v)
const _date_check  = (...parts) => {
  const rx = RegExp('^'+parts.map(p => p.source||p).join('')+'$')
  return v => v instanceof Date || rx.test(v)
}
const YYYY = /\d{4}/
const MM = /-(0[1-9]|1[0-2])/
const DD = /-(0[1-9]|[12]\d|3[01])/
const hh = /[0-2]\d/
const mm = /:[0-5]\d/
const ss = /(?::[0-5]\d)?/
const ms = /(?::[0-5]\d(?:\.\d+)?)?/
const tz = /(?:Z|[+-][0-2]\d:?[0-5]\d)?/

const $ = cds.linked.classes
$.UUID.prototype        .strict_check = _regex_check (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
$.boolean.prototype     .strict_check = v => typeof v === 'boolean'
$.boolean.prototype     .type_check = v => typeof v === 'boolean' || v === 0 || v === 1
$.number.prototype      .type_check = v => !isNaN(v)
$.Integer.prototype     .type_check = _range_check (2**53)
$.Int16.prototype       .type_check = _range_check (2**15)
$.Int32.prototype       .type_check = _range_check (2**31)
$.Int64.prototype       .type_check = _range_check (2n**63n)
$.UInt8.prototype       .type_check = _range_check (256+1,0)
$.Time.prototype        .type_check = _date_check (hh,mm,ss)
$.Date.prototype        .type_check = _date_check (YYYY,MM,DD)
$.DateTime.prototype    .type_check = _date_check (YYYY,MM,DD,'(?:T',hh,mm,ss,tz,')?')
$.Timestamp.prototype   .type_check = _date_check (YYYY,MM,DD,'(?:T',hh,mm,ms,tz,')?')
$.Binary.prototype      .type_check = v => Buffer.isBuffer(v) || typeof v === 'string'
$.LargeBinary.prototype .type_check = v => Buffer.isBuffer(v) || typeof v === 'string' || v instanceof Readable
$.LargeString.prototype .type_check = v => Buffer.isBuffer(v) || typeof v === 'string' || v instanceof Readable

// Mixin above class extensions to cds.linked.classes
$.mixin ( Decimal, string, $any, action, array, struct, entity, Association, Composition )
