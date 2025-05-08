const cds = require('../index')
module.exports = predicate


/** @import cqn from './cqn' */
/** @returns {cqn.xo[]} */
function predicate (...args) {
  const [x] = args
  if (x) switch (typeof x) {
    case 'object':
      if (x.raw) return _ttl(args)
      if (args.length > 1) return _legacy(...args) //> legacy support for predicate (ref`a`, '=', val`b`)
      if (is_array(x)) return x
      if (is_cqn(x)) return [x]
      else return _qbe(x)
    case 'string': return _fluid(args)
    default: return args.map(_val)
  }
}


function _ttl (args) {
  const cxn = cds.parse.expr(...args)
  return cxn.xpr ?? [cxn] //> the fallback is for single-item exprs like `1` or `ref`
}


function _fluid (args) {
  if (args.length === 3) switch (args[1]) {
    case '=': case '<': case '<=': case '>': case '>=': case '!=': case '<>': case 'like': case 'in': case 'IN': case 'LIKE':
      return _legacy (...args)
  }
  if (args.length % 2 === 0) args.push('')
  const expr = args.filter((_, i) => i % 2 === 0).join(' ? ')
  const vals = args.filter((_, i) => i % 2 === 1)
  const { xpr } = _pred_expr(expr); (function _fill_in_vals_into (xpr) {
    xpr.forEach((x, i) => {
      if (x.xpr) _fill_in_vals_into(x.xpr)
      if (x.param) xpr[i] = _val(vals.shift())
    })
  })(xpr)
  return xpr
}


function _qbe (o, xpr=[]) {

  let count = 0
  for (let k in o) { const x = o[k]

    if (k.startsWith('not ')) { xpr.push('not'); k = k.slice(4) }
    switch (k) { // handle special cases like {and:{...}} or {or:{...}}
      case 'between':
        xpr.push('between', _val(x), 'and', _val(o.and))
        return xpr
      case 'and': xpr.push(k)
        x.or ? xpr.push({xpr:_qbe(x)}) : _qbe(x,xpr)
        continue
      case 'or':  xpr.push(k)
        _qbe(x,xpr)
        continue
      case 'not': 
        if (count++) xpr.push('and')  //> add 'and' between conditions
        xpr.push(k)
        if (x && typeof x === 'object') x.in || x.like || x.exists || x.between ? _qbe(x,xpr) : xpr.push({xpr:_qbe(x)})
        else xpr.push(x === null ? 'null' : {val:x})
        continue
      case 'is': xpr.push('is')
        if (x && typeof x === 'object') _qbe(x,xpr)
        else xpr.push(x === null ? 'null' : {val:x})
        continue
      case 'is not': xpr.push('is','not')
        if (x && typeof x === 'object') _qbe(x,xpr)
        else xpr.push(x === null ? 'null' : {val:x})
        continue
      case 'exists':
        if (count++) xpr.push('and')  //> add 'and' between conditions
        xpr.push(k,_ref(x)||x)
        continue
      case 'in': case 'IN': // REVISIT: 'IN' is for compatibility only
        xpr.push(k, x.SELECT ? x : { list: x.map(_val) })
        continue
      case '=': case '<': case '<=': case '>': case '>=': case '!=': case '<>': case 'like': case 'LIKE': // REVISIT: 'LIKE' is for compatibility only
        xpr.push(k,_val(x))
        continue
    }

    const a = cds.parse.ref(k)        //> turn key into a ref for the left side of the expression
    if (count++) xpr.push('and')      //> add 'and' between conditions
    if (!x || typeof x !== 'object')  xpr.push (a,'=',{val:x})
    else if (is_array(x))             xpr.push (a,'in',{list:x.map(_val)})
    else if (x.SELECT || x.list)      xpr.push (a,'in',x)
    else if (is_cqn(x))               xpr.push (a,'=',x)
    else if (x instanceof Date)       xpr.push (a,'=',{val:x})
    else if (x instanceof Buffer)     xpr.push (a,'=',{val:x})
    else if (x instanceof RegExp)     xpr.push (a,'like',{val:x})
    else { xpr.push(a); _qbe(x,xpr) } //> recurse into nested qbe
  }
  return xpr
}


/** @deprecated */
const _legacy = (x,o,y) => [ _ref(x)||x, o, _val(y) ]

const _pred_expr = x => {
  if (typeof x !== 'string') return {val:x}
  if (x === '*') return x
  const t = /^\s*([\w.'?]+)(?:\s*([!?\\/:=\-+<~>]+|like)\s*([\w.'?]+))?\s*$/.exec(x)
  if (!t) return cds.parse.expr(x)
  const [,lhs,op,rhs] = t
  return !op ? _ref_or_val(lhs) : {xpr:[ _ref_or_val(lhs), op, _ref_or_val(rhs) ]}
}

const _ref_or_val = (x) => {
  if (x[0] === '?')  return { param: true, ref: x }
  if (x[0] === "'")  return { val: x.slice(1,-1).replace(/''/g, "'") }
  if (x === 'null')  return { val: null }
  if (x === 'true')  return { val: true }
  if (x === 'false') return { val: false }
  if (!isNaN(x))     return { val: Number(x) }
  else               return { ref: x.split('.') }
}

const _ref = x => typeof x === 'string' ? { ref: x.split('.') } : x // if x is a string, turn it into a ref; if not we assume it's a cxn object
const _val = x => !x ? {val:x} : is_array(x) ? { list: x.map(_val) } : is_cqn(x) ? x : {val:x}

const is_cqn = x => typeof x === 'object' && (
  'ref' in x ||
  'val' in x ||
  'xpr' in x ||
  'list' in x ||
  'func' in x ||
  'SELECT' in x
)
const is_array = Array.isArray
