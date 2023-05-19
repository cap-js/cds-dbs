const cds = require('@sap/cds/lib')
// TODO: add useful debugging information
// const DEBUG = cds.log('computed')

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

module.exports = (db = cds.db) => {
  db.Functions = functions
  db._helpers = db._helpers || {}
  db._helpers.compute = true
  db.on('SELECT', computed.bind(db))
}

const computed = async function (req, next) {
  const cqn = this.cqn4sql(req.query)
  // cqn properties that contain functions
  // expr columns, groupBy, orderBy
  // xpr where, having, from.join.on
  const allRefs = []
  const alias = cqn.SELECT.from.as
  // TODO: collect all internal aliases
  const hasXpr = extract(cqn, alias ? { [alias]: true } : {}, allRefs)

  // If the query does not contain any computations continue
  if (!hasXpr) {
    return next()
  }

  // Re uses the previous processor when available
  if (cqn._processor) {
    return cqn._processor(req.data)
  }

  const rawQuery = cqn.clone ? cqn.clone() : cds.ql.clone(cqn)
  rawQuery.__internal__ = true

  const additionalRefs = allRefs.filter(
    r =>
      (!alias || r.ref[0] === alias) &&
      !cqn.SELECT.columns.find(c => c.ref?.[c.ref?.length - 1] === r.ref[r.ref.length - 1])
  )

  // Enhance select columns with calculation relevant references
  rawQuery.SELECT.columns = [...rawQuery.SELECT.columns, ...additionalRefs]

  // Calculate column processing to determine whether there are aggregate functions used
  const cols = rawQuery.SELECT.columns
    .map(c => {
      const functionCalls = []
      const columnAlias = c.as || c.val || c.func || c.ref?.[c.ref?.length - 1]
      const js = `res[${JSON.stringify(columnAlias)}] = ${compile.call(this, c, rawQuery, functionCalls)}${
        this._helpers.where && columnAlias === '__where__' ? ';if(!res.__where__)continue' : ''
      }`
      return {
        js,
        alias: columnAlias,
        hasSubQueries: /this.run\(/.test(js),
        // If one function is an aggregate function this column has to be calculated after all row level function
        aggregate: functionCalls.find(fn => fn.aggregate)
      }
    })
    // Sort columns to allow for early filtering
    .sort((a, b) => {
      if (a.hasSubQueries && !b.hasSubQueries) return 1
      if (b.hasSubQueries) return -1
      const isPriv = /__.*__/
      if (isPriv.test(a.alias) && !isPriv.test(b.alias)) return 1
      if (isPriv.test(b.alias)) return -1
      return 0
    })

  // Remove all columns containing calculations
  rawQuery.SELECT.columns = rawQuery.SELECT.columns.filter(
    c => !('xpr' in c || 'func' in c || 'val' in c || 'list' in c || 'SELECT' in c)
  )

  const hasAggregate = cols.find(c => c.aggregate)
  if (hasAggregate) {
    // Disable groupBy as the full dataset is required for the aggregate functions
    rawQuery.SELECT.groupBy = undefined
    // Remove limit and one as the aggregate requires all data
    rawQuery.SELECT.limit = undefined
    rawQuery.SELECT.one = undefined
  }

  const transformations = []

  Array.prototype.push.apply(
    transformations,
    cols.filter(c => !c.aggregate).map(c => c.js)
  )

  if (hasAggregate) {
    // Calculate groupBy when defined on the query
    if (rawQuery.SELECT.groupBy) {
      const groupByFunctions = []
      transformations.push(
        `res.__groupBy__ = [${rawQuery.SELECT.groupBy.map(expr =>
          compile.call(this, expr, rawQuery, groupByFunctions)
        )}]`
      )
      if (groupByFunctions.find(fn => fn.aggregate)) {
        cds.error`Aggregate functions are note allowed in groupBy clause`
      }
    } else {
      const groupByCols = cols.filter(c => c.alias.startsWith('__groupBy'))
      if (groupByCols.length) {
        transformations.push(`res.__groupBy__ = [${groupByCols.map(c => `res[${JSON.stringify(c.alias)}]`)}]`)
      }
    }
  }

  const aggregateTransformations = cols.filter(c => c.aggregate).map(c => c.js)

  const processorDefinition = `
data = await data
if(!data || !data.length) {
  return data
}
data = data.slice()

let i
${hasAggregate ? 'const groups = {}' : 'let pos = 0'}
for(i = 0; i < data.length; i++) {
  const row = data[i]
  const res = {}
  ${transformations.join('\n')}
  ${
    hasAggregate
      ? `
  const groupKey = String(res.__groupBy__)
  delete res.__groupBy__
  const group = groups[groupKey] = groups[groupKey] || []
  group.push(res)
`
      : 'data[pos++] = res'
  }
}

${
  hasAggregate
    ? `
const groupKeys = Object.keys(groups)
for(i = 0; i < groupKeys.length; i++) {
  const group = groups[groupKeys[i]]
  const res = group[0]
  // TODO: check whether this alias check should be removed as well
  const row = ${alias ? '{' + JSON.stringify(alias) + ':res}' : 'res'}
  ${aggregateTransformations.join('\n')}
  data[i] = res
}

data.splice(i)`
    : 'data.splice(pos)'
}

return data
`

  const rawData = this.run(rawQuery)
  const process = new AsyncFunction('data', 'rawQuery', 'params', processorDefinition).bind(this, rawData, rawQuery)
  process.src = processorDefinition

  let originalQuery = cqn
  let curLevel = originalQuery
  while (curLevel.__proto__) {
    curLevel = curLevel.__proto__
    if (curLevel.SELECT) {
      originalQuery = curLevel
    }
  }
  originalQuery._processor = process
  return process(req.data)
}

// Extraction
const extract = function (cqn, aliases, refs) {
  const SELECT = function ({ SELECT }) {
    return SELECT
      ? [
          SELECT.columns?.map(expr),
          SELECT.groupBy?.map(expr),
          SELECT.orderBy?.map(expr),
          xpr({ xpr: SELECT.where }),
          xpr({ xpr: SELECT.having }),
          xpr({ xpr: SELECT.from?.join?.on }),
          xpr(SELECT.from)
        ]
          .flat(Infinity)
          .filter(a => a)
          .reduce((l, c) => l || c, false)
      : []
  }

  const expr = function (x) {
    if (x === undefined) return
    if (typeof x !== 'object') throw cds.error`Unsupported expr: ${x}`
    if ('param' in x) return true
    if ('ref' in x) {
      if (x.ref[0] in aliases) {
        refs.push(x)
      }
      return
    }
    if ('val' in x) return true
    if ('xpr' in x) {
      xpr(x, refs)
      return true
    }
    if ('func' in x) {
      expr({ list: x.args }, refs)
      return true
    }
    if ('list' in x) return x.list.reduce((l, c) => expr(c, refs) || l, false)
    if ('SELECT' in x) return SELECT(x, refs)
    else throw cds.error`Unsupported expr: ${x}`
  }

  const xpr = function ({ xpr }) {
    return (xpr || []).reduce((l, x) => {
      if (typeof x === 'string') return true
      else return expr(x, refs) || l
    }, false)
  }
  return SELECT(cqn)
}

// Compilation
const compile = function (expr, query, funcs = []) {
  const columnMap = {}
  query.SELECT.columns.forEach(c => {
    if (c.ref) {
      const path = c.ref
      columnMap[path] = c.as || c.ref[c.ref.length - 1]
    }
  })

  const compExpr = x => {
    if (typeof x !== 'object') return JSON.stringify(x)

    if ('param' in x) {
      return `params${x.ref.map(r => `[${JSON.stringify(r)}]`).join('')}`
    }
    if ('ref' in x) {
      const resultName = columnMap[x.ref]
      // TODO: check whether the resultName can be undefined
      return !resultName ? JSON.stringify(x) : `row[${JSON.stringify(resultName)}]`
    }
    if ('val' in x) {
      if ('cast' in x) {
        const inputConverter = x.element[this.constructor._convertInput]
        if (inputConverter) {
          return `(${inputConverter})(${compExpr({ val: x.val })},cds.builtin.types[${JSON.stringify(x.element.type)}])`
        }
      }
      if (x.val instanceof RegExp) {
        return JSON.stringify(x.val.source)
      }
      if (typeof x.val === 'function') {
        cds.error`A val cannot be a function`
      }
      return JSON.stringify(x.val ?? null)
    }
    if ('xpr' in x) return `(${compXpr(x)})`
    if ('func' in x) {
      const func = functions[x.func]
      if (!func) {
        cds.error`Unknown function ${x.func}`
      }
      funcs.push(func)
      return `this.Functions[${JSON.stringify(x.func)}].fn${
        func.aggregate ? `(group,${JSON.stringify(x.args)})` : `(row,[${x.args.map(compExpr)}])`
      }`
    }
    if ('list' in x) {
      return `[${x.list.map(compExpr)}]`
    }
    if ('SELECT' in x)
      return `(await this.run(
  cds.ql.SELECT${x.SELECT.one ? '.one' : ''}${
        x.SELECT.columns ? `.columns(${JSON.stringify(x.SELECT.columns)})` : ''
      }.from(${JSON.stringify(x.SELECT.from)})${
        x.SELECT.where ? `.where([${x.SELECT.where.map(w => subSELECT(w, x.SELECT.from.as))}])` : ''
      }${x.SELECT.groupBy ? `.groupBy(${compExpr({ xpr: x.SELECT.groupBy })})` : ''}${
        x.SELECT.having ? `.having(${compExpr({ xpr: x.SELECT.having })})` : ''
      }${x.SELECT.orderBy ? `.orderBy(${compExpr({ xpr: x.SELECT.orderBy })})` : ''}${
        x.SELECT.limit ? `.limit(${JSON.stringify(x.SELECT.limit)}` : ''
      },
  row
))`
    // return cds.error`TODO: ADD SUB SELECT SUPPORT`
    cds.error`UNKNOWN EXPR ${JSON.stringify(x)}`
  }

  const subSELECT = (x, alias) => {
    if (alias && x.ref && x.ref.length > 1 && x.ref[0] !== alias) {
      x = { ref: x.ref.slice(1), param: true }
    }
    return JSON.stringify(x)
  }

  const compXpr = ({ xpr }) => {
    return (xpr || [])
      .map((x, i, xpr) => {
        if (typeof x === 'string') {
          const ops = x.trim().split(' ')
          return ops
            .map(x => {
              const op = operators[x.toUpperCase()]
              if (op == null) {
                cds.error`Unknown operator ${JSON.stringify(x)}`
              }
              return typeof op === 'function' ? op(x, i, xpr) : op
            })
            .join(' ')
        }
        return compExpr(x)
      })
      .join(' ')
  }
  return compExpr(expr)
}

// Operators
String.prototype.like = function (pattern) {
  return this.match(pattern instanceof RegExp ? pattern : pattern.replace(/%/g, '.*').replace(/_/g, '.'))
}

const operators = {
  EXISTS: `'0' in `,
  IN: 'in',
  '=': '===',
  '!=': '!==',
  '>': '>',
  '<': '<',
  '>=': '>=',
  '<=': '<=',
  '||': '+',
  AND: '&&',
  OR: '||',
  NOT: '!',
  LIKE: (e, i, expr) => {
    // Put brackets around pattern string
    expr[i + 1] = { xpr: [expr[i + 1]] }
    return '?.like?.'
  },

  CASE: '',
  WHEN: '(',
  THEN: ')?(',
  ELSE: '):(',
  END: (e, i, expr) => {
    const hasElse = expr.slice(expr.slice(0, i).lastIndexOf('case'), i).lastIndexOf('else') > -1
    return hasElse ? ')' : ':null)'
  }
}

// Functions
const functions = {
  count: {
    aggregate: true,
    fn: (data /*args*/) => {
      return data.length
    }
  },
  countdistinct: {
    aggregate: true,
    fn: (data, [col]) => {
      const prop = col.ref[col.ref.length - 1]
      const found = {}
      for (let i = 0; i < data.length; i++) {
        found[data[i][prop]] = true
      }
      return Object.keys(found).length
    }
  },
  avg: {
    aggregate: true,
    fn: (data, [col]) => {
      const prop = col.ref[1]
      let avg = 0
      const cnt = data.length
      for (let i = 0; i < data.length; i++) {
        avg += data[i][prop] / cnt
      }
      return avg
    }
  },
  sum: {
    aggregate: true,
    fn: (data, [col]) => {
      const prop = col.ref[1]
      let total = 0
      for (let i = 0; i < data.length; i++) {
        total += data[i][prop]
      }
      return total
    }
  },
  max: {
    aggregate: true,
    fn: (data, [col]) => {
      const prop = col.ref[1]
      let max = data[0][prop] || 0
      for (let i = 1; i < data.length; i++) {
        if (data[i][prop] > max) {
          max = data[i][prop]
        }
      }
      return max
    }
  },
  min: {
    aggregate: true,
    fn: (data, [col]) => {
      const prop = col.ref[1]
      let min = data[0][prop] || 0
      for (let i = 1; i < data.length; i++) {
        if (data[i][prop] < min) {
          min = data[i][prop]
        }
      }
      return min
    }
  },

  search: {
    // TODO: make sure that args are not compiled, but raw cqn
    fn: (row, [cols, match]) => {
      if (!cols?.length) cds.error`SEARCH MISSING COLUMN LIST ARGUMENT`
      if (!match || !match.length) cds.error`SEARCH MISSING TERM ARGUMENT`

      const regexp = new RegExp(match, 'i')

      // Check all columns references for the sub string
      for (var i = 0; i < cols.length; i++) {
        if (cols[i]?.match?.(regexp)) return true
      }
      return false
    }
  },

  // String functions
  length: { fn: (row, [str]) => str.length },
  indexof: { fn: (row, [str, subStr]) => str?.indexOf(subStr) },
  substring: { fn: (row, [str, s, e]) => str?.slice(s, e === undefined ? undefined : s + e) },
  trim: { fn: (row, [str]) => str?.trim() },
  contains: { fn: (row, [str, subStr]) => str?.indexOf(subStr) > -1 },
  endswith: { fn: (row, [str, subStr]) => str?.endsWith(subStr) || false },
  startswith: { fn: (row, [str, subStr]) => str?.startsWith(subStr) || false },
  tolower: { fn: (row, [str]) => str.toLowerCase() },
  toupper: { fn: (row, [str]) => str.toUpperCase() },
  concat: { fn: (row, args) => args.join('') },

  // Numbers
  ceiling: { fn: (row, [nr]) => Math.ceil(nr) },
  floor: { fn: (row, [nr]) => Math.floor(nr) },
  round: { fn: (row, [nr]) => Math.round(nr) },

  // Date
  year: { fn: (row, [date]) => (date instanceof Date ? date : new Date(date)).getUTCFullYear() },
  month: { fn: (row, [date]) => (date instanceof Date ? date : new Date(date)).getUTCMonth() + 1 },
  day: { fn: (row, [date]) => (date instanceof Date ? date : new Date(date)).getUTCDate() },
  hour: { fn: (row, [date]) => (date instanceof Date ? date : new Date(date)).getUTCHours() },
  minute: { fn: (row, [date]) => (date instanceof Date ? date : new Date(date)).getUTCMinutes() },
  second: { fn: (row, [date]) => (date instanceof Date ? date : new Date(date)).getUTCSeconds() }
}

functions.average = functions.avg
