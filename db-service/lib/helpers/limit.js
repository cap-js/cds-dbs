const cds = require('@sap/cds/lib')
// TODO: add useful debugging information
// const DEBUG = cds.log('limit')

module.exports = (db = cds.db) => {
  db.on('SELECT', limit.bind(db))
}

const limit = async function (req, next) {
  const cqn = this.cqn4sql(req.query)

  if (!cqn.SELECT.limit && !cqn.SELECT.one) {
    return next()
  }

  const clone = cqn.clone()
  clone.__internal__ = true

  const limit = clone.SELECT.limit || { rows: { val: 1 } }
  clone.SELECT.limit = undefined
  clone.SELECT.one = undefined

  const data = await this.run(clone, req.data)
  if (!data || !data.length) {
    return data
  }
  const offset = limit.offset?.val || 0

  // Splice to retain the $count property
  data.splice(0, offset)
  data.splice(offset + limit.rows.val)

  return data
}
