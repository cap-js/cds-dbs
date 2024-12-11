let initSqlJs

if (typeof window === 'object') {
  window.exports = {}
  window.module = {}
  await import('sql.js')
  initSqlJs = window.module.exports

} else {
  initSqlJs = (await import('sql.js')).default
}

const init = initSqlJs({
  locateFile: window
    ? (file) => {
      return `https://sql.js.org/dist/${file}`
    }
    : undefined
})
delete window.exports
delete window.module

class WasmSqlite {
  constructor(/*database*/) {
    // TODO: load / store database file contents
    this.ready = init
      .then(SQL => { this.db = new SQL.Database() })

    this.memory = true
    this.gc = new FinalizationRegistry(stmt => { stmt.free() })
  }

  prepare(sql) {
    const stmt = this.db.prepare(sql)
    const ret = {
      run: (params) => {
        try {
          stmt.bind(params)
          stmt.step()
          return { changes: this.db.getRowsModified(stmt) }
        } catch (err) {
          if (err.message.indexOf('NOT NULL constraint failed:') === 0) {
            err.code = 'SQLITE_CONSTRAINT_NOTNULL'
          }
          throw err
        }
      },
      get: (params) => {
        const columns = stmt.getColumnNames()
        stmt.bind(params)
        stmt.step()
        const row = stmt.get()
        const ret = {}
        for (let i = 0; i < columns.length; i++) {
          ret[columns[i]] = row[i]
        }
        return ret
      },
      all: (params) => {
        const columns = stmt.getColumnNames()
        const ret = []
        stmt.bind(params)
        while (stmt.step()) {
          const row = stmt.get()
          const obj = {}
          for (let i = 0; i < columns.length; i++) {
            obj[columns[i]] = row[i]
          }
          ret.push(obj)
        }
        return ret
      }
    }
    this.gc.register(ret, stmt)
    return ret
  }

  exec(sql) {
    try {
      const { columns, values } = this.db.exec(sql)
      return !Array.isArray(values) ? values : values.map(val => {
        const ret = {}
        for (let i = 0; i < columns.length; i++) {
          ret[columns[i]] = val[i]
        }
        return ret
      })
    } catch (err) {
      // REVISIT: address transaction errors
      if (sql === 'BEGIN' || sql === 'ROLLBACK') { return }
      throw err
    }
  }

  function(name, config, func) {
    this.db.create_function(name, func || config)
  }

  close() { this.db.close() }
}

export default WasmSqlite
