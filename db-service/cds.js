const cds = (module.exports = require('@sap/cds/lib'))
const _default = {
  cqn2sql: require('./lib/cqn2sql'),
  cqn4sql: require('./lib/cqn4sql'),
}

cds.extend(cds.ql.Query).with(
  class {
    forSQL(db = cds.db || _default) {
      return this.flat(db.cqn4sql(this))
    }
    toSQL(db = cds.db || _default) {
      return _2sql(db.cqn2sql(this))
    }
    toSql(db = cds.db || _default) {
      return this.toSQL(db).sql
    }
  },
)

// skip .cqn property when in repl
const _2sql = cds.repl ? ({ sql, values }) => ({ sql, values }) : x => x

cds.ApplicationService // FIXME: somehow we need to invoke the getter, must be removed in the future
