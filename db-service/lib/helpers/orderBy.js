const cds = require('@sap/cds/lib')
// TODO: add useful debugging information
// const DEBUG = cds.log('orderBy')

module.exports = (db = cds.db) => {
  db.on('SELECT', orderBy.bind(db))
}

const orderBy = async function (req, next) {
  const cqn = this.cqn4sql(req.query)

  if (!cqn.SELECT.orderBy) {
    return next()
  }

  const clone = cqn.clone()
  clone.__internal__ = true

  // Remove having clause and moves it into a '__groupBy__' column
  const orderBy = clone.SELECT.orderBy
  clone.SELECT.columns = [...clone.SELECT.columns, ...orderBy.map((c, i) => ({ __proto__: c, as: `__orderBy${i}__` }))]
  clone.SELECT.orderBy = undefined

  const data = await this.run(clone, req.data)
  if (!data) return data

  let sections = [[0, data.length]]
  let nextSections
  for (let i = 0; i < orderBy.length; i++) {
    const key = `__orderBy${i}__`
    const compare = orderBy[i].sort === 'desc' ? (a, b) => a[key] < b[key] : (a, b) => a[key] > b[key]
    let changes = true
    while (changes) {
      changes = false
      nextSections = [[0, 1]]
      for (let s = 0; s < sections.length; s++) {
        const section = sections[s]
        for (let x = section[0]; x < section[1] - 1; x++) {
          const a = data[x]
          const b = data[x + 1]
          if (compare(a, b)) {
            data[x] = b
            data[x + 1] = a
            changes = true
          }
          if (changes) {
            continue
          }
          if (a[key] === b[key]) {
            nextSections[nextSections.length - 1][1]++
          } else {
            nextSections.push([x, x + 1])
          }
        }
      }
    }
    if (nextSections.length === data.length) {
      break
    }
    sections = nextSections
  }

  return data
}
