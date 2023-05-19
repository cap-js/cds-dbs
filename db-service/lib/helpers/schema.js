const cds = require('@sap/cds/lib')
// TODO: add useful debugging information
// const DEBUG = cds.log('schema')

module.exports = (db = cds.db, converters) => {
  const _add_mixins = (aspect, mixins) => {
    const fqn = db.constructor.name + aspect
    const types = cds.builtin.types
    for (let each in mixins) {
      const def = types[each]
      if (!def) continue
      Object.defineProperty(def, fqn, { value: mixins[each] })
    }
    return fqn
  }

  db.constructor._convertInput = _add_mixins(':convertInput', converters.InputConverters)
  db.constructor._convertOutput = _add_mixins(':convertOutput', converters.OutputConverters)

  // TODO: add insert/update schema validation
  db.after('SELECT', schema.bind(db))
}

const schema = async function (data, req) {
  // __internal__ indicates that the query is part of a sub routine for another query
  // preventing data from being converted multiple times
  if (!data?.length || req.query.__internal__) {
    return
  }
  const cqn = this.cqn4sql(req.query)
  const converterKey = this.constructor._convertOutput
  const converters = Object.keys(cqn.elements)
    .map(e => ({ prop: e, fn: cqn.elements[e][converterKey] }))
    .filter(e => e.fn)

  for (let i = 0; i < data.length; i++) {
    const row = data[i]
    for (let i = 0; i < converters.length; i++) {
      const converter = converters[i]
      row[converter.prop] = converter.fn(row[converter.prop])
    }
  }
}
