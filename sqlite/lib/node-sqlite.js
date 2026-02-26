const { DatabaseSync } = require('node:sqlite');

class NodeSqlite extends DatabaseSync {
  prepare(sql) {
    const stmt = super.prepare(sql)
    const ret = {
      run(params) {
        try {
          params = Array.isArray(params) ? params : [params]
          return stmt.run(...params)
        } catch (err) {
          if (err.message.indexOf('NOT NULL constraint failed:') === 0) {
            err.code = 'SQLITE_CONSTRAINT_NOTNULL'
          }
          throw err
        }
      },
      get(params) {
        params = Array.isArray(params) ? params : [params]
        return stmt.get(...params)
      },
      all(params) {
        params = Array.isArray(params) ? params : [params]
        return stmt.all(...params)
      },
      iterate(params) {
        stmt.setReturnArrays(true)
        params = Array.isArray(params) ? params : [params]
        return stmt.iterate(...params)
      }
    }
    return ret
  }
}

module.exports = NodeSqlite
