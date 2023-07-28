const cds = require('@sap/cds/lib')
// TODO: add useful debugging information
// const DEBUG = cds.log('one')

module.exports = (db = cds.db) => {
  db.on('SELECT', one.bind(db))
}

const one = async function (req, next) {
  const cqn = this.cqn4sql(req.query)

  if (!cqn.SELECT.one) {
    return next()
  }

  const clone = cqn.clone()
  clone.__internal__ = true

  clone.SELECT.one = undefined
  clone.SELECT.limit = { rows: { val: 1 } }
  const data = await this.run(clone, req.data)
  return data?.[0] ?? null
}
