const { SQLService } = require('@cap-js/db-service')
const { Readable } = require('stream')
const cds = require('@sap/cds/lib')
const sqlite = require('better-sqlite3')
const $session = Symbol('dbc.session')
const convStrm = require('stream/consumers')

class SQLiteService extends SQLService {
  get factory() {
    return {
      options: { max: 1, ...this.options.pool },
      create: tenant => {
        const database = this.url4(tenant)
        const dbc = new sqlite(database)
        dbc.function('session_context', key => dbc[$session][key])
        dbc.function('regexp', { deterministic: true }, (re, x) => (RegExp(re).test(x) ? 1 : 0))
        dbc.function('ISO', { deterministic: true }, d => d && new Date(d).toISOString())
        if (!dbc.memory) dbc.pragma('journal_mode = WAL')
        return dbc
      },
      destroy: dbc => dbc.close(),
      validate: dbc => dbc.open,
    }
  }

  url4(tenant) {
    let { url, database: db = url } = this.options.credentials || this.options || {}
    if (!db || db === ':memory:') return ':memory:'
    if (tenant) db = db.replace(/\.(db|sqlite)$/, `-${tenant}.$1`)
    return cds.utils.path.resolve(cds.root, db)
  }

  set(variables) {
    const dbc = this.dbc || cds.error('Cannot set session context: No database connection')
    if (!dbc[$session]) dbc[$session] = variables
    else Object.assign(dbc[$session], variables)
  }

  release() {
    this.dbc[$session] = undefined
    return super.release()
  }

  prepare(sql) {
    try {
      const stmt = this.dbc.prepare(sql)
      return {
        run: (..._) => this._run(stmt, ..._),
        get: (..._) => stmt.get(..._),
        all: (..._) => stmt.all(..._),
        stream: (..._) => this._stream(stmt, ..._),
      }
    } catch (e) {
      e.message += ' in:\n' + (e.sql = sql)
      throw e
    }
  }

  async _run(stmt, binding_params) {
    for (let i = 0; i < binding_params.length; i++) {
      const val = binding_params[i]
      if (Buffer.isBuffer(val)) {
        binding_params[i] = Buffer.from(val.base64Slice())
      } else if (typeof val === 'object' && val && val.pipe) {
        // REVISIT: stream.setEncoding('base64') sometimes misses the last bytes
        // if (val.type === 'binary') val.setEncoding('base64')
        binding_params[i] = await convStrm.buffer(val)
        if (val.type === 'binary') binding_params[i] = Buffer.from(binding_params[i].toString('base64'))
      }
    }
    return stmt.run(binding_params)
  }

  async *_iterator(rs, one) {
    // Allow for both array and iterator result sets
    const first = Array.isArray(rs) ? { done: !rs[0], value: rs[0] } : rs.next()
    if (first.done) return
    if (one) {
      yield first.value[0]
      // Close result set to release database connection
      rs.return()
      return
    }

    yield '['
    // Print first value as stand alone to prevent comma check inside the loop
    yield first.value[0]
    for (const row of rs) {
      yield `,${row[0]}`
    }
    yield ']'
  }

  _changeToStreams(cqn, rows, first) {
    if (!rows.length) return

    // REVISIT: (1) refactor (2) consider extracting to a method compat
    if (first) { 
      rows[0][Object.keys(rows[0])[0]] = this._stream(Object.values(rows[0])[0])
      return
    }

    for (let col of cqn.SELECT.columns) {
      const name = col.ref[col.ref.length-1] 
      if (col.element?.type === 'cds.LargeBinary') {
        if (cqn.SELECT.one) rows[0][name] = this._stream(rows[0][name])
        else
          rows.forEach(row => {
            row[name] = this._stream(row[name])
          })        
      }
    }
  } 

  _stream(val) {
    if (val === null) return null
    // Buffer.from only applies encoding when the input is a string
    let raw = Buffer.from(val.toString(), 'base64')
    return new Readable({
      read(size) {
        if (raw.length === 0) return this.push(null)
        const chunk = raw.slice(0, size) // REVISIT
        raw = raw.slice(size)
        this.push(chunk)
      },
    })    
  }

  exec(sql) {
    return this.dbc.exec(sql)
  }

  static CQN2SQL = class CQN2SQLite extends SQLService.CQN2SQL {

    column_alias4(x, q) {
      let alias = super.column_alias4(x, q)
      if (alias) return alias
      if (x.ref) {
        let obm = q._orderByMap
        if (!obm) {
          Object.defineProperty(q, '_orderByMap', { value: (obm = {}) })
          q.SELECT?.orderBy?.forEach(o => {
            if (o.ref?.length === 1) obm[o.ref[0]] = o.ref[0]
          })
        }
        return obm[x.ref.at(-1)]
      }
    }

    val(v) {
      // intercept DateTime values and convert to Date objects to compare ISO Strings
      if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[Z+-]/.test(v.val)) v.val = new Date(v.val)
      return super.val(v)
    }

    // Used for INSERT statements
    static InputConverters = {
      ...super.InputConverters,

      // The following allows passing in ISO strings with non-zulu
      // timezones and converts them into zulu dates and times
      Date: e => `strftime('%Y-%m-%d',${e})`,
      Time: e => `strftime('%H:%M:%S',${e})`,

      // Both, DateTimes and Timestamps are canonicalized to ISO strings with
      // ms precision to allow safe comparisons, also to query {val}s in where clauses
      DateTime: e => `ISO(${e})`,
      Timestamp: e => `ISO(${e})`,
    }

    static OutputConverters = {
      ...super.OutputConverters,

      // Structs and arrays are stored as JSON strings; the ->'$' unwraps them.
      // Otherwise they would be added as strings to json_objects.
      struct: expr => `${expr}->'$'`, // Association + Composition inherits from struct
      array: expr => `${expr}->'$'`,

      // SQLite has no booleans so we need to convert 0 and 1
      boolean: expr => `CASE ${expr} when 1 then 'true' when 0 then 'false' END ->'$'`,

      // DateTimes are returned without ms added by InputConverters
      DateTime: e => `substr(${e},0,20)||'Z'`,

      // Timestamps are returned with ms, as written by InputConverters.
      // And as cds.builtin.classes.Timestamp inherits from DateTime we need
      // to override the DateTime converter above
      Timestamp: undefined,

      // int64 is stored as native int64 for best comparison
      // Reading int64 as string to not loose precision
      Int64: expr => `CAST(${expr} as TEXT)`,

      // Binary is not allowed in json objects
      Binary: expr => `${expr} || ''`,
    }

    // Used for SQL function expressions
    static Functions = { ...super.Functions,
      // Ensure ISO strings are returned for date/time functions
      current_timestamp: () => 'ISO(current_timestamp)',
      // SQLite doesn't support arguments for current_date and current_time
      current_date: () => 'current_date',
      current_time: () => 'current_time',
    }

    // Used for CREATE TABLE statements
    static TypeMap = {
      ...super.TypeMap,
      Binary: e => `BINARY_BLOB(${e.length || 5000})`,
      Date: () => 'DATE_TEXT',
      Time: () => 'TIME_TEXT',
      DateTime: () => 'DATETIME_TEXT',
      Timestamp: () => 'TIMESTAMP_TEXT',
    }

    get is_distinct_from_() { return 'is not' }
    get is_not_distinct_from_() { return 'is' }

    static ReservedWords = { ...super.ReservedWords, ...require('./ReservedWords.json') }
  }

  // REALLY REVISIT: Here we are doing error handling which we probably never should have started.
  // And worst of all, we handed out this as APIs without documenting it, so stakeholder tests rely
  // on that? -> we urgently need to review these stakeholder tests.
  // And we'd also need this to be implemented by each db service, and therefore documented, correct?
  async onINSERT(req) {
    try {
      return await super.onINSERT(req)
    } catch (err) {
      throw _not_unique(err, 'ENTITY_ALREADY_EXISTS') || err
    }
  }

  async onUPDATE(req) {
    try {
      return await super.onUPDATE(req)
    } catch (err) {
      throw _not_unique(err, 'UNIQUE_CONSTRAINT_VIOLATION') || err
    }
  }

  _convertStreamValues(values) {
    let any
    values.forEach((v, i) => {
      if (v instanceof Readable) {
        any = values[i] = new Promise((resolve, reject) => {
          const chunks = []
          v.on('data', chunk => chunks.push(chunk))
          v.on('end', () => resolve(Buffer.concat(chunks)))
          v.on('error', err => {
            v.removeAllListeners('error')            
            reject(err)
          })
        })
      }
    })
    return any ? Promise.all(values) : values
  }

  async onSIMPLE({ query, data }) {
    const { sql, values } = this.cqn2sql(query, data)
    let ps = await this.prepare(sql)
    const vals = await this._convertStreamValues(values)
    return (await ps.run(vals)).changes
  }
}

// function _not_null (err) {
//   if (err.code === "SQLITE_CONSTRAINT_NOTNULL") return Object.assign ({
//     code: 'MUST_NOT_BE_NULL',
//     target: /\.(.*?)$/.exec(err.message)[1], // here we are even constructing OData responses, with .target
//     message: 'Value is required',
//   })
// }

function _not_unique(err, code) {
  if (err.message.match(/unique constraint/i))
    return Object.assign({
      originalMessage: err.message, // FIXME: required because of next line
      message: code, // FIXME: misusing message as code
      code: 400, // FIXME: misusing code as (http) status
    })
}

module.exports = SQLiteService
