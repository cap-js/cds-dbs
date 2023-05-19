const cds = require('@sap/cds/lib')
// TODO: add useful debugging information
// const DEBUG = cds.log('count')

module.exports = (db = cds.db) => {
  db.on('SELECT', count.bind(db))
}

const count = async function (req, next) {
  const cqn = this.cqn4sql(req.query)

  if (!cqn.SELECT.count) {
    return next()
  }

  const clone = cqn.clone()
  clone.__internal__ = true

  clone.SELECT.count = undefined
  const data = await this.run(clone, req.data)
  data.$count = await requiresCountQuery.call(this, clone, data)

  return data
}

const requiresCountQuery = async function (query, ret) {
  if (ret) {
    const { one, limit: _ } = query.SELECT,
      n = ret.length
    const [max, offset = 0] = one ? [1] : _ ? [_.rows?.val, _.offset?.val] : []
    if (max === undefined || (n < max && (n || !offset))) return n + offset
  }
  const cq = cds.ql.clone(query, {
    columns: [{ func: 'count' }],
    localized: false,
    expand: false,
    one: true,
    // hide properties
    limit: undefined,
    orderBy: undefined,
    count: undefined
  })
  const { count } = await this.run({ query: cq })
  return count
}
