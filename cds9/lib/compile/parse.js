const cdsc = require ('@sap/cds-compiler')
const cds = require ('../index')

const parse = module.exports = exports = (...args) => parse.cdl (...args)

exports.cdl = function cdl (x,...etc) {
  if (x.raw) return parse.ttl (cdl, x,...etc)
  else return cds.compile (x, etc[0], 'parsed')
}

exports.cql = function cql (x,...etc) { try {
  if (x.raw) return parse.ttl (cql, x,...etc)
  // add missing 'from' clause if not present -> REVISIT: this is a hack unless compiler accepts partial cql
  const from = x.match(/ from /i); if (!from) x = x.replace(/( where | having | group by | order by | limit |$)/i, x => ' from $' + x)
  const cqn = cdsc.parse.cql(x,undefined,{ messages:[], ...etc[0] })
  if (!from) delete cqn.SELECT.from
  return cqn
} catch(e) {
  // cds-compiler v5 does not put messages into `e.message` anymore; render them explicitly
  e.message = !e.messages ? e.message : e.toString();
  e.message = e.message.replace('<query>.cds:',`In '${e.cql = x}' at `)
  throw e // with improved error message
}}

exports.path = function path (x,...etc) {
  if (x.raw) return parse.ttl (path, x,...etc)
  if (cds.model?.definitions[x]) return {ref:[x]}
  if (/^([\w_.$]+)$/.test(x)) return {ref:[x]}  // optimized parsing of simple paths of length 1
  const [,head,tail] = /^([\w._]+)(?::(\w+))?$/.exec(x)||[]
  if (tail) return {ref:[head,...tail.split('.')]}
  if (head) return {ref:[head]}
  const {SELECT} = cdsc.parse.cql('SELECT from '+x, undefined, { messages: [] })
  return SELECT.from
}

exports.expr = function expr (x,...etc) {
  if (x.raw) return parse.ttl (expr, x,...etc)
  if (typeof x !== 'string') throw cds.error.expected `${{x}} to be an expression string`
  if (x in globals) return globals[x]                         // optimized parsing of true, false, null
  if (/^([\d.]+)$/.test(x)) return {val:Number(x)}           // optimized parsing of numeric vals
  if (/^([\w_$]+)$/.test(x)) return native[x] || {ref:[x]}  // optimized parsing of simple refs of length 1
  if (/^([\w_.$]+)$/.test(x)) return {ref:x.split('.')}    // optimized parsing of simple refs of length > 1
  try { return cdsc.parse.expr (x,undefined,{ messages:[], ...etc[0] }) } catch(e) {
    // cds-compiler v5 does not put messages into `e.message` anymore; render them explicitly
    e.message = !e.messages ? e.message : e.toString();
    e.message = e.message.replace('<expr>.cds:1:',`In '${e.expr = x}' at `)
    throw e // with improved error message
  }
}

exports.xpr = (...args) => {
  const y = parse.expr (...args)
  return y.xpr || [y]
}

exports.ref = (x,...etc) => {
  const ntf = {null:{val:null},true:{val:true},false:{val:false}}[x]; if (ntf) return ntf
  if (/^[A-Za-z_$][\w.]*$/.test(x)) return { ref: x.split('.') }
  else return parse.expr (x,...etc)
}

exports.properties = (...args) => (parse.properties = require('./etc/properties').parse) (...args)
exports.yaml = (...args) => (parse.yaml = require('./etc/yaml').parse) (...args)
exports.csv = (...args) => (parse.csv = require('./etc/csv').parse) (...args)
exports.json = (...args) => JSON.parse (...args)


exports.ttl = (parse, strings, ...values) => {

  // Reusing cached results for identical template strings w/o values
  // if (!values.length) {
  //   const cache = _parse_ttl.cache ??= new WeakMap
  //   if (cache.has(strings)) return cache.get(strings)
  //   let parsed = parse (strings[0])
  //   cache.set(strings,parsed)
  //   return parsed
  // }

  let cql = values.reduce ((cql,v,i) => {
    if (Array.isArray(v) && strings[i].match(/ in $/i)) values[i] = { list: v.map(cxn4) }
    return cql + strings[i] + (v instanceof cds.entity ? v.name : ':'+i)
  },'') + strings.at(-1)
  const cqn = parse (cql) //; cqn.$params = values
  return merge (cqn, values)

  function merge (o,values) {
    for (let k in o) {
      const x = o[k]
      if (!x) continue
      if (x.param) {
        let val = values[x.ref[0]]; if (val === undefined) continue
        let y = o[k] = cxn4(val) //; y.$ = x.ref[0]
        if (x.cast) y.cast = x.cast
        if (x.key) y.key = x.key
        if (x.as) y.as = x.as
      } else if (typeof x === 'object') merge(x,values)
    }
    return o
  }
}


/** @protected */
exports._select = (prefix, ttl, suffix) => {
  let [ strings, ...values ] = ttl; strings = [...strings]; strings.raw = strings; // need that as ttl strings are sealed
  if (prefix) strings[0] = `SELECT ${prefix} ${strings[0]}`; else strings[0] = `SELECT ${strings[0]}`
  if (suffix) strings[strings.length-1] += ` ${suffix}`
  return cds.parse.cql (strings, ...values).SELECT
}

const native = {
  current_date         : { func: 'current_date' },
  current_time         : { func: 'current_time' },
  current_timestamp    : { func: 'current_timestamp' },
  current_user         : { func: 'current_user' },
  current_utcdate      : { func: 'current_utcdate' },
  current_utctime      : { func: 'current_utctime' },
  current_utctimestamp : { func: 'current_utctimestamp' },
  session_user         : { func: 'session_user' },
  sysuuid              : { func: 'sysuuid' },
  CURRENT_DATE         : { func: 'current_date' },
  CURRENT_USER         : { func: 'current_user' },
  CURRENT_TIME         : { func: 'current_time' },
  CURRENT_TIMESTAMP    : { func: 'current_timestamp' },
  CURRENT_UTCDATE      : { func: 'current_utcdate' },
  CURRENT_UTCTIME      : { func: 'current_utctime' },
  CURRENT_UTCTIMESTAMP : { func: 'current_utctimestamp' },
  SESSION_USER         : { func: 'session_user' },
  SYSUUID              : { func: 'sysuuid' },
}
const is_cqn = x => typeof x === 'object' && (
  'ref' in x ||
  'val' in x ||
  'xpr' in x ||
  'list' in x ||
  'func' in x ||
  'SELECT' in x
)
const cxn4 = x => is_cqn(x) ? x : {val:x}
const globals = { true: {val:true}, false: {val:false}, null: {val:null} }
