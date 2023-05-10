const cds = module.exports = require('@sap/cds/lib')
const { extend, lazified } = cds

extend(cds).with(lazified({
  inferred: lazy => require('./lib/ql/cds.infer'),
  cqn2sql: lazy => require('./lib/db/sql/cqn2sql'),
  cqn4sql: lazy => require('./lib/db/sql/cqn4sql'),
}))

extend (cds.ql.Query) .with (class {
  forSQL (db = cds.db || cds) { return this.flat(db.cqn4sql(this)) }
  toSQL  (db = cds.db || cds) { return _2sql(db.cqn2sql(this)) }
  toSql  (db = cds.db || cds) { return this.toSQL(db).sql }
})

// Monkey-patch req.event to be undefined for plain sql query strings -> remove when @sap/cds 6.6 is released
const $super = Reflect.getOwnPropertyDescriptor(cds.Request.prototype,'event')
Reflect.defineProperty (cds.Request.prototype,'event', {...$super, get(){
  if (typeof this.query === 'string') return this._set ('event', undefined)
  else return $super.get.call(this)
}})

// skip .cqn property when in repl
const _2sql = cds.repl ? ({sql,values}) => ({sql,values}) : x => x

cds.ApplicationService // FIXME: somehow we need to invoke the getter, must be removed in the future

// cds.requires.kinds.postgres = {
//   kind: 'postgres',
//   dialect: 'plain',
//   credentials: {
//     "host": "localhost",
//     "port": "5432",
//     "database": "beershop", //> override per test
//     "username": "postgres",
//     "password": "postgres"
//   },
//   impl: __dirname + '/lib/db/pg'
// }
