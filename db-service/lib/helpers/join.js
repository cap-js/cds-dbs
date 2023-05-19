const cds = require('@sap/cds/lib')
// TODO: add useful debugging information
// const DEBUG = cds.log('groupBy')

const columnMap = require('./projection').columnMap

module.exports = (db = cds.db) => {
  db.on('SELECT', join.bind(db))
}

const join = async function (req, next) {
  const cqn = this.cqn4sql(req.query)

  const from = cqn.SELECT.from
  // needs to be a string as sub selects have join as a function
  if (typeof from.join !== 'string') {
    return next()
  }

  const normJoin = {}

  const isRight = from.join === 'right'
  const isCross = from.join === 'cross'
  const isInner = from.join === 'inner'
  normJoin.root = from.args[isRight ? 1 : 0]
  normJoin.target = from.args[isRight ? 0 : 1]

  // TODO: define columns that are required not just *
  const rootQuery = cds.ql.SELECT()
  rootQuery.SELECT.from = normJoin.root
  rootQuery.__internal__ = true

  const crossQuery = cds.ql.SELECT()
  crossQuery.SELECT.from = normJoin.target
  crossQuery.__internal__ = true

  const rootAliases = aliases(normJoin.root)
  const rootAlias = alias(normJoin.root)
  const targetAlias = alias(normJoin.target)

  let [rootData, crossData] = await Promise.all([
    this.run(rootQuery, req.data),
    isCross ? this.run(crossQuery, req.data) : []
  ])

  console.log(rootData.length)
  const subQuery = cds.ql.SELECT.from(normJoin.target).where(on({ xpr: from.on }, rootAliases))
  subQuery.__internal__ = true

  const data = (
    await Promise.all(
      rootData.map(async row => {
        let targetData
        if (isCross) {
          targetData = crossData
        } else {
          targetData = await this.run(subQuery, rootAlias ? { [rootAlias]: row } : row)
        }
        if (!isInner && targetData.length === 0) {
          targetData.push({})
        }

        return targetData.map(
          rootAlias
            ? targetRow => ({ [targetAlias]: targetRow, [rootAlias]: row })
            : targetAlias
            ? targetRow => ({ [targetAlias]: targetRow, ...row })
            : targetRow => ({ ...targetRow, ...row })
        )
      })
    )
  ).flat()

  if (cqn.SELECT.columns) {
    columnMap(cqn)(data)
  }

  return data
}

const aliases = function (from) {
  const ret = {}
  const as = alias(from)
  if (!as) {
    Object.assign(ret, ...from.args.map(aliases))
  } else {
    ret[as] = true
  }
  return ret
}

const alias = function (from) {
  return from.as || (from.ref && from.ref[from.ref.length - 1])
}

// Replace all refs to the source with the row data
const on = function (on, aliases) {
  const expr = function (x) {
    if (x === undefined) return
    if (typeof x === 'string') throw cds.error`Unsupported expr: ${x}`
    if ('param' in x) return x
    if ('ref' in x) {
      if (x.ref[0] in aliases) {
        x.param = true
      }
      return x
    }
    if ('val' in x) return x
    if ('xpr' in x) return xpr(x)
    if ('func' in x) return { __proto__: x, args: (x.args || []).map(expr) }
    if ('list' in x) return { list: x.list.map(expr) }
    if ('SELECT' in x) throw cds.error`SELECT is not supported in on condition ${x}`
    else throw cds.error`Unsupported expr: ${x}`
  }

  const xpr = function ({ xpr }) {
    return (xpr || []).map(x => {
      if (typeof x === 'string') return x
      else return expr(x)
    })
  }

  return expr(on)
}
