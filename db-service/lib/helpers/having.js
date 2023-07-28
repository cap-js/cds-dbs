const cds = require('@sap/cds/lib')
// TODO: add useful debugging information
// const DEBUG = cds.log('having')

module.exports = (db = cds.db) => {
  db.on('SELECT', having.bind(db))
}

const having = async function (req, next) {
  const cqn = this.cqn4sql(req.query)

  if (!cqn.SELECT.having) {
    return next()
  }

  const clone = cqn.clone()
  clone.__internal__ = true

  // Remove having clause and moves it into a '__having__' column
  clone.SELECT.columns = [...clone.SELECT.columns, { xpr: clone.SELECT.having, as: '__having__' }]
  clone.SELECT.having = undefined

  const data = await this.run(clone, req.data)
  return data?.filter(r => r.__having__)
}
