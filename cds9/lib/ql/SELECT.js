const Whereable = require('./Whereable')
const is_number = x => !isNaN(x)
const cds = require('../index')
const $ = Object.assign

class SELECT extends Whereable {

  /** @type import('./cqn').SELECT['SELECT'] */
  SELECT = {}

  static call = (..._) => (new this)._select_or_from(..._) // SELECT `x`...
  static API = {
    columns:      (..._) => (new this).columns(..._),
    from:       $((..._) => (new this).from(..._), {
      localized:  (..._) => (new this).localized.from(..._)
    }),
    localized:  $((..._) => (new this).localized._select_or_from(..._),{
      columns:    (..._) => (new this).localized.columns(..._),
      from:       (..._) => (new this).localized.from(..._),
    }),
    distinct:   $((..._) => (new this).distinct._select_or_from(..._),{
      localized:  (..._) => (new this).distinct.localized.from(..._),
      columns:    (..._) => (new this).distinct.columns(..._),
      from:       (..._) => (new this).distinct.from(..._),
    }),
    one:        $((..._) => (new this).one._select_or_from(..._),{
      localized:  (..._) => (new this).one.localized.from(..._),
      columns:    (..._) => (new this).one.columns(..._),
      from:       (..._) => (new this).one.from(..._),
    }),
    read:         (..._) => (new this)._select_or_from(..._),
    class: this
  }

  get localized() { this.SELECT.localized = true; return this }
  get distinct() { this.SELECT.distinct = true; return this }
  get one() { this.SELECT.one = true; return this }

  /** @private */ _select_or_from (x,...etc) {
    if (!x) return this
    else if (x == '*') return this.columns (x,...etc)
    else switch (typeof x) {
      case 'string': {
        if (etc.length) return this._ambiguous (x,...etc)
        else (x = [x]).raw = x // single arg -> resolve in case 'object' block below
      }
      case 'object': { // eslint-disable-line no-fallthrough
        if (x.raw) { // TODO: We might add a cache and reuse parsed [cqn,params] ...
          const SELECT = cds.parse._select('',[x,...etc]), {columns:cols} = SELECT
          if (SELECT.from || cols.length > 1 || !cols[0].ref) // SELECT `from Foo` | `a,b` | `max(a)`
            return this._assign (SELECT)
          const { columns:[{ expand, ...from }], ...more_clauses } = SELECT
          if (expand) more_clauses.columns = expand  // SELECT `Foo {a,b}`
          if (0 in Object.keys(more_clauses))       // SELECT `Foo where x=1`
            return this._assign ({from}, more_clauses)
          else return this._ambiguous (x,...etc)
        }
        else if (Array.isArray(x)) return this.columns(x)
        else if (x.kind === 'element') return this.columns (x,...etc)
        else if (x.name) return this.from (x,...etc)
        else if (x.ref) return this._ambiguous (x,...etc)
        else if (x.from) return this._assign(x)
        else if (x.SELECT || x.SET) return this.from(x)
        else break
      }
      default: return this.columns(x)
    }
    throw this._expected `Argument for SELECT(${{x}}) to be a valid argument for SELECT.from or .columns`
  }

  /** @private */ _ambiguous (...xy) {
    const {SELECT:_} = this, {one} = _
    this.from(...xy)._set('from', (...the_real_target) => {
      if (!one) delete _.one; delete _.columns; delete this.from
      return this.from (...the_real_target) .columns (...xy)
    })
    return this
  }

  columns (...cols) {
    if (cols[0]) this._add ('columns', cds.ql.columns(...cols))
    return this
  }

  from (...args) {
    const [target] = args
    if (target.raw) {
      let { from, ...more } = cds.parse._select ('from',args)
      this.SELECT.from = this._target4 (from)
      return this._assign(more)
    }
    this.SELECT.from = this._target4 (target)
    const [,second,third] = args
    if (second !== undefined) {
      if (third) {
        this.byKey(second)
        this.columns(third)
      } else {
        if (Array.isArray(second) || typeof second === 'function') this.columns(second)
        else this.byKey(second)
      }
    }
    return this
  }

  /** @deprecated */ fullJoin  (other, as) { return this.join (other, as, 'full') }
  /** @deprecated */ leftJoin  (other, as) { return this.join (other, as, 'left') }
  /** @deprecated */ rightJoin (other, as) { return this.join (other, as, 'right') }
  /** @deprecated */ innerJoin (other, as) { return this.join (other, as, 'inner') }
  /** @deprecated */ join (other, as, kind='inner') {
    const [, target, alias = as] = /(\S+)(?:\s+(?:as)?\s+(\S+))?/i.exec(other)
    const ref = { ref: [target] }; if (alias) ref.as = alias
    this.SELECT.from = { join:kind, args: [this.SELECT.from, ref] }
    return Object.defineProperty(this, '_where_or_having', { value: 'on', configurable: true })
  }
  /** @deprecated */ on (...args) {
    const {from} = this.SELECT
    if (!from?.join) throw new Error(`Invalid call of "SELECT.on()" without prior call of "SELECT.join()"`)
    // string values in on clause are interpreted as refs, not vals
    const [o] = args; if (typeof o === 'object' && !o.raw && !Array.isArray(o)) {
      for (let a in o) if (typeof o[a] === 'string') o[a] = {ref:o[a].split('.')}
    }
    return this._where (args,'on',from)
  }

  having(...args) {
    return this._where (args,'having')
  }

  search (...args) {
    let _xpr=[]; for (let val of args) _xpr.push('or',{val})
    this.SELECT.search = _xpr.slice(1)
    return this
  }

  groupBy (...args) {
    if (!args[0]) return this
    const cqn = args[0].raw ? cds.parse._select('from X group by', args).groupBy : args.map(cds.parse.ref)
    return this._add('groupBy',cqn)
  }

  orderBy (...args) {
    if (!args[0]) return this
    return this._add('orderBy', cds.ql.orders(...args))
  }

  limit (rows, offset) {
    if (is_number(rows) || rows) this.SELECT.limit = rows.rows ? rows : { rows: {val:rows} }
    if (is_number(offset)) (this.SELECT.limit = (this.SELECT.limit || {})) .offset = { val: offset }
    return this
  }

  forUpdate ({ of, wait = cds.env.sql.lock_acquire_timeout || -1, ignoreLocked } = {}) {
    const sfu = this.SELECT.forUpdate = {}
    if (of) sfu.of = of.map (c => ({ref:c.split('.')}))
    if (ignoreLocked) sfu.ignoreLocked = true
    else if (wait >= 0) sfu.wait = wait
    return this
  }

  /** @deprecated */ forShareLock () {
    this.SELECT.forShareLock = true
    return this
  }

  hints (...args) {
    if (args.length) this.SELECT.hints = args.flat()
    return this
  }

  valueOf() { return super.valueOf('SELECT * FROM') }
  get _subject(){ return this.SELECT.from }
  get elements() { return this.elements = cds.infer.elements (this) }
  set elements(e) { this._set('elements',e) }
}


/** @type SELECT.API & (...columns:string[]) => SELECT */
module.exports = SELECT.init()
