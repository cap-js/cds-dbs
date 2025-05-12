const { inspect } = require('node:util')
const format = x => inspect(
  is.error(x) ? x.message
  : typeof x === 'object' && 'status' in x && 'body' in x ? { status: x.status, body: x.body }
  : typeof x === 'object' && 'status' in x && 'data' in x ? { status: x.status, data: x.data }
  : x,
  { colors: true, sorted: true, depth: 11 }
)

const expect = module.exports = actual => {
  const chainable = function (x) { return this.call(x) }; delete chainable.length
  return Object.setPrototypeOf(chainable, new Assertion(actual))
}

const is = new class {
  Array = Array.isArray
  Error = x => x instanceof Error || x?.stack && x.message
  Symbol = x => typeof x === 'symbol'
  Object = x => typeof x === 'object' // && x && !is.array(x)
  String = x => typeof x === 'string' || x instanceof String
  Number = x => typeof x === 'number' || x instanceof Number
  Boolean = x => typeof x === 'boolean' || x instanceof Boolean
  Promise = x => x instanceof Promise
  RegExp = x => x instanceof RegExp
  Date = x => x instanceof Date
  Set = x => x instanceof Set
  Map = x => x instanceof Map
  array = this.Array
  error = this.Error
  symbol = this.Symbol
  object = this.Object
  string = this.String
  number = this.Number
  boolean = this.Boolean
  promise = this.Promise
  regexp = this.RegExp
  date = this.Date
  set = this.Set
  map = this.Map
  /** Jest-style any matcher */
  any = expect.any = type => {
    if (type === undefined) return () => true
    else return this [type.name || type] || (x => x instanceof type)
  }
}


class Core {

  constructor (actual) { this._ = actual }

  /** The central method to throw an AssertionError. */
  expected ([a, be, ...etc], ...args) {
    const raw = [a, (this._not ? ' NOT' : '') + be, ...etc]
    const err = new expected({ raw }, ...args)
    // err.operator = be.trim().replace(/^to /,'')
    // err.expected = args[1]
    // err.actual = args[0]
    throw err
  }

  should ([be, ...etc], ...args) {
    return this.expected(['', ' to ' + be, ...etc], this._, ...args)
  }

  /** The central method to check assertions. */
  assert (check, _fail = () => false) {
    const outcome = check(this._)
    if (this._not ? outcome : !outcome) return _fail(outcome)
    else return this
  }

  instanceof (x) {
    return this.assert(a => a instanceof x) || this.should`be an instance of ${x.name || x}`
  }

  kindof (x) {
    return this.assert(is.any(x)) || this.should`be kind of ${x?.name || x}`
  }

  equals (x, _fail = () => this.should`strictly equal ${x}`) {
    if (typeof x === 'function') return this.assert(x)
    if (this._deep) return this.eqls(x)
    return this.assert(a => a === x, _fail)
  }

  eqls (x, _fail = () => this.should`deeply equal ${x}`) {
    if (typeof x === 'function') return this.assert(x)
    return this.assert(a => compare(a, x, true), _fail)
  }

  subset (x, _fail = () => this.should`contain subset ${x}`) {
    return this.assert(a => {
      if (is.array(a) && is.array(x)) return x.every(x => a.some(o => compare(o,x)))
      if (is.array(a) && !is.array(x)) return a.some(o => compare(o,x))
      else return compare(a,x)
    }, _fail)
  }

  matches (x, _fail = () => this.should`match ${x}`) {
    return this.assert(a => {
      if (is.regexp(x)) return x.test(a)
      if (is.string(x)) return a.includes?.(x)
      if (is.object(x)) return this.subset(x) && !this._not //> to avoid doubled not
      // if (is.array(x)) return x.every(x => a.includes(x))
    }, _fail)
  }

  includes (x, _fail = () => this.should`include ${x}`) {
    return this.assert(a => {
      if (!a) expected`an array or string or set or object but got ${a}`
      if (is.string(a)) return a.includes(x)
      if (is.array(a)) return a.includes(x) || this._deep && a.some(o => compare(o,x))
      if (is.set(a)) return a.has(x)
      if (is.object(a)) return compare(a,x)
    }, _fail)
  }

  oneOf (x, _fail = () => this.should`be one of ${x}`) {
    return this.assert(a => x.includes(a), _fail)
  }

  throws (x, _fail = () => this.should`throw ${x}`) {
    if (is.promise(this._)) return this.rejectsWith(x)
    return this.assert(a => {
      if (typeof a === 'function') try { a(); return false } catch (err) { if (!x) return true; else this._= a = err }
      if (typeof x.test === 'function') return x.test(a)
      if (typeof x === 'function') return x(a)
      if (typeof x === 'string') return a == x || a.code == x || a.message?.includes(x)
      if (typeof x === 'object') return compare(a,x)
    }, _fail)
  }

  rejectsWith (x) {
    if (this._not) return Promise.resolve(this._).catch(
      e => expected`promise to be fulfilled but it was rejected with ${e}`
    )
    else return Promise.resolve(this._).then(
      y => expected`promise to be rejected but it was fulfilled with ${y}`,
      e => {
        if (x) expect(e).throws(x, () => expected`promise to be rejected with ${x} but got ${e}`)
        return e
      }
    )
  }

  length (ln) {
    return this.assert(a => (a.length ?? String(a).length) === ln, () => this.should`have length ${ln}`)
  }

  property (p, v) {
    const has = !this._own ? (a, p) => a && typeof a === 'object' && p in a : Reflect.getOwnPropertyDescriptor
    const get = (a, p) => has(a, p) ? a[p] : $not_found, $not_found = {}
    const y = this.assert(() => true) && !this._nested ? get(this._, p) : (p.split?.('.') ?? p).reduce((a, p) => get(a, p), this._)
    if (y === $not_found) return this._not || (this._nested
      ? this.should`have nested property ${p}`
      : this.should`have property ${p}`)
    const that = Object.assign(expect(), this, { _: y })
    if (v !== undefined) return that.eqls(v, () => this._nested
      ? this.should`have nested property ${p} with value ${v}`
      : this.should`have property ${p} with value ${v}`)
    return that
  }

  keys (...keys) {
    if (is.array(keys[0])) keys = keys[0]
    return this.assert(a => keys.every(k => k in a)) || this.should`have all keys ${keys}`
  }

  gt (x) { return this.assert(a => a > x) || this.should`be > ${x}` }
  lt (x) { return this.assert(a => a < x) || this.should`be < ${x}` }
  gte (x) { return this.assert(a => a >= x) || this.should`be >= ${x}` }
  lte (x) { return this.assert(a => a <= x) || this.should`be <= ${x}` }
  within (x, y) { return this.assert(a => x <= a && a <= y) || this.should`be within ${[x, y]}` }
}


class Chai extends Core {

  // linguistic chaining

  get to() { return this }
  get be() { this.call = this.equals; return this }
  get is() { this.call = this.equals; return this }
  get at() { return this }
  get of() { return this }
  get and() { return this }
  get but() { return this }
  get has() { this.call = this.property; return this }
  get have() { this.call = this.property; return this }
  get that() { return this }
  get does() { return this }
  get with() { return this }
  get also() { return this }
  get still() { return this }
  get which() { return this }
  get eventually() {
    this.assert = (fn, _fail) => Promise.resolve(this._).then(a => expect(a).assert(fn, _fail))
    return this
  }

  // flags changing behaviour of subsequent methods in the chain

  get not() { this._not = true; return this }
  get own() { this._own = true; return this }
  get deep() { this._deep = true; return this }
  get nested() { this._nested = true; return this }
  get ordered() { return unsupported() }
  get any() { return unsupported() }
  get all() { return this }

  get undefined() { return this.assert(a => a === undefined) || this.should`be undefined` }
  get exist() { return this.assert(a => a != undefined) || this.should`exist` }
  get truthy() { return this.assert(a => !!a) || this.should`be truthy` }
  get falsy() { return this.assert(a => !a) || this.should`be falsy` }
  get null() { return this.assert(a => a === null) || this.should`be ${null}` }
  get true() { return this.assert(a => a === true) || this.should`be ${true}` }
  get false() { return this.assert(a => a === false) || this.should`be ${false}` }
  get empty() { return this.assert(a => !a?.length === 0 || Object.keys(a).length === 0) || this.should`be empty` }
  get NaN() { return this.assert(a => isNaN(a)) || this.should`be ${NaN}` }
  get ok() { return this.truthy }

  get containSubset() { return this.subset }
  get contains() { return new Proxy (this.includes,{
    get: (fn,k) => {
      if (k === 'deep') {
        this._deep = fn
        return (...args) => fn.call(this,...args)
      }
      else return fn[k]
    },
    apply: (fn,t,args) => fn.call (this,...args)
  })}
  get contain() { return this.contains }
  get include() { return this.contains }
  get match() { return this.matches }
  get equal() { return this.equals }
  get eq() { return this.equals }
  get eql() { return this.eqls }
  get exists() { return this.defined }
  get lengthOf() { return this.length }
  get instanceOf() { return this.instanceof }
  get kindOf() { return this.kindof }
  get kind() { return this.kindof }
  get an() { this.call = this.kindof; return this }
  get a() { this.call = this.kindof; return this }
  get key() { return this.keys }

  get below() { return this.lt }
  get above() { return this.gt }
  get most() { return this.lte }
  get least() { return this.gte }
  get lessThan() { return this.lt }
  get greaterThan() { return this.gt }
  get lessThanOrEqual() { return this.lte }
  get greaterThanOrEqual() { return this.gte }

  get throw() { return this.throws }
  get fulfilled() { return this.not.rejectsWith() }
  get rejected() { return this.rejectsWith() }
  get rejectedWith() { return this.rejectsWith }
}


class Jest extends Chai {

  get resolves() { return this.eventually }
  get rejects() { return this.eventually }
  get toBe() { return this.equals }
  get toEqual() { return this.eqls }
  get toMatch() { return this.matches }
  get toMatchObject() { return this.matches }
  get toContainEqual() { return this.deep.includes }
  get toContain() { return this.includes }
  get toThrow() { return this.throws }
  get toThrowError() { return this.throws }
  get toBeGreaterThan() { return this.gt }
  get toBeLessThan() { return this.lt }
  get toBeGreaterThanOrEqual() { return this.gte }
  get toBeLessThanOrEqual() { return this.lte }
  get toHaveProperty() { return this.nested.property }
  get toHaveLength() { return this.length }

  toBeNull() { return this.null }
  toBeFalsy() { return this.falsy }
  toBeTruthy() { return this.truthy }
  toBeDefined() { return this.defined }
  toBeUndefined() { return this.undefined }
  toBeInstanceOf() { return this.instanceof }
  toMatchSnapshot() { unsupported('toMatchSnapshot') }

  // mocking
  toHaveBeenCalled() {
    return this.assert (
      fn => fn.mock.callCount() > 0,
      () => this.should`have been called at least once`
    )
  }
  toHaveBeenCalledTimes (count) {
    return this.assert (
      fn => count === fn.mock.callCount(),
      () => this.should`have been called ${count} times, but was called ${this._.mock.callCount()} times`
    )
  }
  toHaveBeenCalledWith (...args) {
    return this.assert (
      fn => fn.mock.calls.some(c => compare(c.arguments,args,true)),
      () => this.should`have been called with ${args}`
    )
  }
  toHaveBeenLastCalledWith (...args) {
    return this.assert (
      fn => compare(fn.mock.calls.at(-1).arguments,args,true),
      () => this.should`have been last called with ${args}`
    )
  }

  static expect() {
    expect.stringMatching = x => a => (is.regexp(x) ? x : RegExp(x)).test?.(a)
    expect.stringContaining = x => a => a?.includes(x)
    expect.arrayContaining = x => a => x.every(e => a.includes(e))
    expect.objectContaining = x => a => compare(a,x)
    expect.any = is.any
  }
}
Jest.expect()


class Assertion extends Jest {
  toString() { return `[ expect: ${format(this._)} ]` }
}


class AssertionError extends Error {
  constructor (m, caller = Assertion.prototype.should) { Error.captureStackTrace (super(m), caller) }
  get caller() { return Assertion.prototype.should }
  get code() { return 'ERR_ASSERTION' }
}

// function AssertionError(m){
//   Error.captureStackTrace (this,this.caller)
//   this.message = m
// }
// AssertionError.prototype = Object.create (Error.prototype, {constructor:{value: AssertionError }})
// AssertionError.__proto__ = Error


expect.fail = function (actual, expected, message) {
  if (arguments.length === 1) throw new AssertionError (actual, expect.fail)
  if (arguments.length === 3) throw Object.assign (new AssertionError (message, expect.fail), { expected, actual })
}

function expected (strings, ...args) {
  const err = new AssertionError ('expected ' + String.raw(strings, ...args.map(format)))
  if (new.target) return err; else throw err
}

function unsupported (method) {
  const ignore = unsupported.skip ??= (process.env._chest_skip || '')?.split(',').reduce((p, c) => (p[c] = 1, p), {})
  if (!method) return new Error(`unsupported`)
  if (method in ignore) return () => { }
  else throw new Error(`
    Method expect .${method}() is not yet supported.
    Use --skip ${method} to skip checks.
  `)
}

function compare (a, b, strict) {
  if (a == b) return true
  if (Buffer.isBuffer(a)) return Buffer.isBuffer(b) && a.equals(b)
  return function _recurse (a, b) {
    if (!a || typeof a !== 'object') return false
    if (!b || typeof b !== 'object') return false
    if (strict)
      for (let k of Object.keys(a)) if (!(k in b))
        return false
    for (let k in b) {
      const v = a[k], x = b[k]; if (v === x) continue
      if (typeof x === 'function') { if (x(v)) continue; else return false }
      if (!_recurse(v, x)) return false
    }
    return true
  }(a, b)
}
