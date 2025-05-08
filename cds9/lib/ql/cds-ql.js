const cds = require ('../index')

/**
 * This is the default export, accessible to users through cds.ql.
 * It's a function turning given input into an instance of cds.ql.Query.
 *
 * - If input is already a Query, it is returned as is.
 * - If input is a string, it is parsed into a CQN object.
 * - If input is a CQN object, an instance of the corresponding
 *   Query subclass is contructed and returned.
 *
 * Use it in a cast-like way like this:
 *
 * @example
 *  let q = cds.ql ({ SELECT: { from: {ref:[ Books.name ]} }})
 *  let q = cds.ql (CQL`SELECT from ${Books}`)
 *  let q = cds.ql `SELECT from ${Books}`
 *
 * @returns { import('./SELECT').class }, or any other subclass of Query; but IntelliSense doen't allow to specify this
 */
const ql = module.exports = exports = (q,...etc) => {
  if (q instanceof Query) return q
  if (q.raw || typeof q === 'string') return ql (cds.parse.cql(q,...etc))
  for (let k in q) if (k in ql) return new ql[k](q[k])
  return q //> no-op
}

// Base class and subclasses for all kinds of queries...
const Query  = exports.Query = require('./cds.ql-Query');
exports.SELECT = require('./SELECT')
exports.INSERT = require('./INSERT')
exports.UPSERT = require('./UPSERT')
exports.UPDATE = require('./UPDATE')
exports.DELETE = require('./DELETE')
exports.CREATE = require('./CREATE')
exports.DROP   = require('./DROP')

exports.resolve = require('./resolve');


exports.predicate = require('./cds.ql-predicates')
exports.columns = require('./cds.ql-projections')
/** @import cqn from './cqn' */


/**
 * Constructs a CXN `{ref}` object from given input, which can be one of:
 *
 * - several path segment strings
 * - a single array of the same
 * - a tagged template literal in CXL path syntax
 *
 * @returns {cqn.ref}
 */
exports.ref = function (...ref) {
  if (ref[0].raw) ref = String.raw(...ref).split('.')
  return {ref}
}


/**
 * Constructs CXN `{val}` object from given input, which can be one of:
 * - a single `string`, `number`, `boolean`, or `null`
 * - a tagged template literal in CXL literal syntax
 *
 * @example
 * val(`foo`) //> {val:'foo'}`
 * val`foo`  //> {val:'foo'}
 * val`11`   //> {val:11}
 * val(11)   //> {val:11}
 *
 * @returns {cqn.val}
 */
exports.val = (...val) => {
  if (val?.[0]?.raw) val = String.raw(...val)
  else [val] = val
  return {val}
}


/**
 * Constructs a CXN `xpr` object from given input, which can be one of:
 *
 * - multiple CXN `expr` objects, or strings representing keywords or operators
 * - a single array of the same
 * - a tagged template literal in CXL syntax
 *
 * @example
 * xpr([ref`foo`,'=',val(11)]) //> {xpr:[{ref:['foo']},'=',{val:11}]}
 * xpr(ref`foo`,'=',val(11))   //> {xpr:[{ref:['foo']},'=',{val:11}]}
 * xpr`foo = 11`               //> {xpr:[{ref:['foo']},'=',{val:11}]}
 * xpr`foo`                    //> {xpr:[{ref:['foo']}]}
 * xpr`'foo'`                  //> {xpr:[{val:'foo'}]}
 * xpr`11`                     //> {xpr:[{val:11}]}
 * xpr('=')                    //> {xpr:['=']}
 * xpr('like')                 //> {xpr:['like']}
 *
 * @see {@link ql.expr `expr`}
 * @returns {cqn.xpr}
 */
exports.xpr = (...xpr) => {
  const x = ql.expr(...xpr)
  return x.xpr ? x : {xpr:[x]} // always returns an `{xpr}` object
}


/**
 * Same as {@link ql.xpr `xpr`}, but if the result contains only single
 * entries these are returned as is.
 *
 * @example
 * expr([ref`foo`,'=',val(11)]) //> {xpr:[{ref:['foo']},'=',{val:11}]}
 * expr(ref`foo`,'=',val(11))   //> {xpr:[{ref:['foo']},'=',{val:11}]}
 * expr`foo = 11`               //> {xpr:[{ref:['foo']},'=',{val:11}]}
 * expr`foo`                    //> {ref:['foo']}
 * expr`11`                     //> {val:11}
 *
 * @returns { cqn.ref & cqn.val & cqn.xpr & cqn.list & cqn.func } the constructed CXN `expr` object.
 */
exports.expr = (...xpr) => {
  const [x] = xpr; if (x?.raw) return cds.parse.expr(...xpr) //> tagged template literal
  else if (is_array(x)) xpr = x //> entries are supposed to be CXN objects
  return xpr.length === 1 ? xpr[0] : {xpr} //> single entries are returned as is
}


/**
 * Constructs a CXN `list` object from given input, with can be one of:
 *
 * - multiple CXN `expr` objects, or values turned into `{val}`s, including strings
 * - a single array of the same
 *
 * @example
 * list([`foo`,11]) //> {list:[{val:'foo'},{val:11}]}
 * list(`foo`,11)   //> {list:[{val:'foo'},{val:11}]}
 * expr`'foo',11`   //> {list:[{val:'foo'},{val:11}]}
 * expr`foo,11`     //> {list:[{ref:['foo']},{val:11}]}
 *
 * @see Use {@link ql.expr `expr()`} to get the same via a tagged template literal.
 * @returns {cqn.list}
 */
exports.list = (...args) => {
  const [x] = args; if (is_array(x)) args = x
  return { list: args.map (_cqn_or_val) }
}


/**
 * Constructs a CXN `func` object from given input. The first argument is the
 * function name, the remaining `args` can the same as in {@link ql.list `list()`},
 * and are handled the same way.
 *
 * @example
 *   func('substring',[`foo`,1]) //> {func:'substring',args:[{val:'foo'},{val:1}]}
 *   func('substring',`foo`,1)   //> {func:'substring',args:[{val:'foo'},{val:1}]}
 *   expr`substring('foo',1)`    //> {func:'substring',args:[{val:'foo'},{val:1}]}
 *   expr`substring(foo,1)`      //> {func:'substring',args:[{ref:['foo']},{val:1}]}
 *   expr`substring(foo,1)`      //> {func:'substring',args:[{ref:['foo']},{val:1}]}
 *
 * @see Use {@link ql.expr `expr()`} to get the same via a tagged template literal.
 * @returns {cqn.func}
 */
exports.func = (func,...args) => {
  const [x] = args; if (is_array(x)) args = x
  return { func, args: args.map (_cqn_or_val) }
}


/** @returns { cqn.ref & cqn.as & cqn.infix &{ columns: cqn.column[] }} */
exports.nested = (ref, ...args) => {
  if (ref.raw) return ql.nested (ql.ref(ref,...args))
  else if (!ref.ref) ref = ql.ref(ref)
  for (let each of args) {
    if (each.as || each.where || each.orderBy || each.limit) ref = {...ref, ...each}
    else ref.columns = ql.columns(each)
  }
  ref.columns ??= ['*']
  return ref
}

exports.expand = (...args) => {
  let { columns, ...rest } = ql.nested (...args)
  return { ...rest, expand: columns }
}

exports.inline = (...args) => {
  let { columns, ...rest } = ql.nested (...args)
  return { ...rest, inline: columns }
}

/** @returns {{ where: cqn.xo[] }} */
exports.where = (...args) => ({where: ql.predicate(...args)})

/** @returns {{ orderBy: cqn.order[] }} */
exports.orderBy = (...args) => ({orderBy: ql.orders(...args)})
exports.orders = (...args) => {
  const [x] = args; if (x.raw) return cds.parse._select('from X order by',args).orderBy
  if (is_array(x)) args = x
  else if (is_object(x) && !x.ref) {
    return Object.entries(x) .map (each => _ordering_term (...each))
  }
  return args.map (each => {
    if (each.ref) return each
    if (typeof each === 'string') return _ordering_term (...each.split(' '))
  })
  function _ordering_term (ref,sort) {
    const ot = cds.parse.ref(ref)
    if (sort) ot.sort = sort == 1 ? 'asc' : sort == -1 ? 'desc' : sort
    return ot
  }
}

/** @returns {{ limit: { rows: { val: any; }; offset?: { val: any; }; }; }} */
exports.limit = (...args) => {
  const [ limit, offset ] = args; if (limit?.raw) return {limit: cds.parse._select('from X limit',args).limit }
  if (!offset) return { limit: { rows: { val: limit } } }
  else return { limit: { rows: { val: +limit }, offset: { val: +offset } } }
};

const _cqn_or_val = x => typeof x === 'object' ? x : {val:x}
const is_object = x => typeof x === 'object'
const is_array = Array.isArray


/**
 * Returns a new instance of Query for the given input,
 * that has the given one as prototype.
 */
exports.clone = function (q,_) {
  return Query.prototype.clone.call(q,_)
}
