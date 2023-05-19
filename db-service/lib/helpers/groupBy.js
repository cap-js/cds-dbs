const cds = require('@sap/cds/lib')
// TODO: add useful debugging information
// const DEBUG = cds.log('groupBy')

module.exports = (db = cds.db) => {
  db.on('SELECT', groupBy.bind(db))
}

const groupBy = async function (req, next) {
  const cqn = this.cqn4sql(req.query)

  if (!cqn.SELECT.groupBy) {
    return next()
  }

  const clone = cqn.clone()
  clone.__internal__ = true

  // Remove having clause and moves it into a '__groupBy__' column
  const groupBy = clone.SELECT.groupBy
  clone.SELECT.columns = [...clone.SELECT.columns, ...groupBy.map((c, i) => ({ __proto__: c, as: `__groupBy${i}__` }))]
  clone.SELECT.groupBy = undefined

  const data = await this.run(clone, req.data)
  if (!data || !data.length) {
    return data
  }

  const groups = {}
  let pos = 0
  for (let i = 0; i < data.length; i++) {
    const row = data[i]
    const key = `${groupBy.map((_, i) => row[`__groupBy${i}__`])}`
    if (!groups[key]) {
      data[pos++] = row
      groups[key] = true
    }
  }

  data.splice(pos)

  return data
}
