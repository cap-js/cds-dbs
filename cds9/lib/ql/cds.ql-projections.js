const predicate = require('./cds.ql-predicates')
const cds = require('../index')

/** @import cqn from './cqn' */
/** @returns {cqn.column[]} */
module.exports = function projection (...args) {
  const [x] = args
  if (x) switch (typeof x) {
    case 'function':
      return _function(x)
    case 'object':
      if (x.raw) return _ttl(args)
      if (is_array(x)) return _array(x)
      break //> processing all args below
    case 'string':
      if (x[0] === '{') return _string(x)
  }
  return _array (args)
}


function _ttl (args) {
  if (args[0][0][0] === '{') return cds.parse._select('from X',args).columns
  return cds.parse._select('',args,'from X').columns
}

function _string (x) {
  return cds.parse.cql('SELECT from X '+ x).SELECT.columns
}


function _array (args) {
  return args.map (column_expr)
  function column_expr (x) {
    switch (typeof x) {
      case 'string': {
        if (x === '*') return x
        let alias = /\s+as\s+(\w+)$/i.exec(x)
        if (alias) return { ...cds.parse.ref(x.slice(0,alias.index)), as: alias[1] }
        return cds.parse.ref(x)
      }
      case 'object': {
        if (x.name) return { ref: [x.name] } //> reflected element
        if (is_cqn(x)) return x //> already a CQN object
        else for (let e in x) return {...cds.parse.ref(e), as: x[e] } //> { element: alias }
        throw this._expected`Argument for SELECT.columns(${x}) to be a valid column expression`
      }
      default: return { val: x }
    }
  }
}


function _function (fn) {
  const columns = []; fn(new Proxy(fn, {
    apply: (_, __, args) => {
      if (!args.length) return columns.push('*')
      let [x] = is_array(args[0]) ? args[0] : args
      columns.push(x === '*' || x === '.*' ? '*' : is_cqn(x) ? x : { ref: [x] })
      return { as: (alias) => (x.as = alias) }
    },
    get: (_, p) => {
      const col = { ref: [p] }; columns.push(col)
      const nested = new Proxy(fn, {
        get: (_, p) => {
          if (p === 'where') return (x) => ((col.where = predicate(x)), nested)
          if (p === 'as') return (alias) => ((col.as = alias), nested)
          else return col.ref.push(p), nested
        },
        apply: (_, __, args) => {
          const [a, b] = args
          if (!a) col.expand = ['*']
          else if (a.raw) switch (a[0]) {
            case '*': col.expand = ['*']; break
            case '.*': col.inline = ['*']; break
            default: {
              // The ttl is the tail of a column expression including infic filter and nested projection.
              // So, we need to add the col name as prefix to be able to parse it...
              const {columns} = cds.parse._select(col.ref.at(-1), args, 'from X')
              Object.assign(col, columns[0])
            }
          }
          else if (is_array(a)) col.expand = _array(a)
          else if (a === '*') col.expand = ['*']
          else if (a === '.*') col.inline = ['*']
          else if (typeof a === 'string') col.ref.push(a)
          else if (typeof a === 'function') {
            let x = (col[/^\(?_\b/.test(a) ? 'inline' : 'expand'] = _function(a))
            if (b?.levels) while (--b.levels) x.push({ ...col, expand: (x = [...x]) })
          } else if (typeof b === 'function') {
            let x = (col[/^\(?_\b/.test(b) ? 'inline' : 'expand'] = _function(b))
            if (a?.depth) while (--a.depth) x.push({ ...col, expand: (x = [...x]) })
          }
          return nested
        },
      })
      return nested
    },
  }))
  return columns
}

const is_cqn = x => typeof x === 'object' && (
  'ref' in x ||
  'val' in x ||
  'xpr' in x ||
  'list' in x ||
  'func' in x ||
  'SELECT' in x
)
const is_array = Array.isArray
