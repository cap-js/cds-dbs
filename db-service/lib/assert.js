const cds = require('@sap/cds')

module.exports = function (db) {
  const { model } = db
  const asserts = []
  for (const entity of model.each(cds.builtin.classes.entity)) {
    const target = !entity.keys
      ? { val: null, param: false, as: 'target' }
      : {
        func: 'concat',
        as: 'target',
        args: [
          { val: entity.name, param: false },
          { val: '(' }, ...Object.keys(entity.keys).filter(k => !entity.keys[k].virtual && !entity.keys[k].isAssociation).map((k, i) => [{ val: (i ? ',' : '') + k + '=', param: false }, { ref: [k] }]).flat(), { val: ')' }
        ]
      }
    for (const element of entity.elements) {
      if (!element['@assert']) continue
      asserts.push(
        cds.ql.SELECT([
          { __proto__: element['@assert'], as: 'message' },
          { ...target, args: [...target.args, { val: '/' + element.name }] },
        ]).from(entity)
      )
    }
  }
  if (asserts.length === 0) return

  const sqls = []
  const CQN2SQL = db.class.CQN2SQL
  for (const query of asserts) {
    const q = db.cqn4sql(query)
    const renderer = new CQN2SQL(q)
    renderer.SELECT(q)
    sqls.push(renderer.sql)
  }

  return `SELECT * FROM (${sqls.join(' UNION ALL ')}) WHERE message IS NOT NULL AND target like (? || '%')`
}
