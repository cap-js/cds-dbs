const cds = require('@sap/cds/lib')
// TODO: add useful debugging information
// const DEBUG = cds.log('where')

module.exports = (db = cds.db) => {
  db._helpers = db._helpers || {}
  db._helpers.where = true

  db.on('SELECT', selectWhere.bind(db))
  db.on('UPDATE', updateWhere.bind(db))
  db.on('DELETE', deleteWhere.bind(db))
}

const selectWhere = async function (req, next) {
  const cqn = this.cqn4sql(req.query)

  if (!cqn.SELECT.where) {
    return next()
  }

  const clone = cds.ql.clone(cqn)
  clone.__internal__ = true

  // Remove where clause and moves it into a '__where__' column
  clone.SELECT.columns = [
    ...clone.SELECT.columns,
    { xpr: clone.SELECT.where.length ? clone.SELECT.where : [{ val: true }], as: '__where__' }
  ]
  clone.SELECT.where = undefined

  const data = await this.run(clone, req.data)
  return data?.filter(r => r.__where__)
}

const updateWhere = async function (req, next) {
  const cqn = this.cqn4sql(req.query)

  if (!cqn.UPDATE.where) {
    return next()
  }

  const impactQuery = cds.ql.SELECT().from(cqn.UPDATE.entity).where(cqn.UPDATE.where)
  impactQuery.__internal__ = true
  const impacted = await this.run(impactQuery, req.data)

  const upd = cds.ql.UPDATE.entity(cqn.UPDATE.entity).data(cqn.UPDATE.data)
  const changes = await Promise.all(
    impacted.map(entry => {
      const cqn = upd.clone()
      cqn.UPDATE.entry = entry
      return this.run(cqn)
    })
  )

  return changes.reduce((l, c) => (l += c), 0)
}

const deleteWhere = async function (req, next) {
  const cqn = this.cqn4sql(req.query)

  if (!cqn.DELETE.where) {
    return next()
  }

  const impactQuery = cds.ql.SELECT().from(cqn.DELETE.from).where(cqn.DELETE.where)
  impactQuery.__internal__ = true
  const impacted = await this.run(impactQuery, req.data)

  const del = cds.ql.DELETE.from(cqn.DELETE.from)
  const changes = await Promise.all(
    impacted.map(entry => {
      const cqn = del.clone()
      cqn.DELETE.entry = entry
      return this.run(cqn)
    })
  )

  return changes.reduce((l, c) => (l += c), 0)
}
