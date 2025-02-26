const { SQLService } = require('@cap-js/db-service')
const cds = require('@sap/cds')
const sqlite = require('better-sqlite3')
const $session = Symbol('dbc.session')
const convStrm = require('stream/consumers')
const { Readable } = require('stream')

const SANITIZE_VALUES = process.env.NODE_ENV === 'production' && cds.env.log.sanitize_values !== false
const keywords = cds.compiler.to.sql.sqlite.keywords
// keywords come as array
const sqliteKeywords = keywords.reduce((prev, curr) => {
  prev[curr] = 1
  return prev
}, {})

// define date and time functions in js to allow for throwing errors
const isTime = /^\d{1,2}:\d{1,2}:\d{1,2}$/
const hasTimezone = /([+-]\d{1,2}:?\d{0,2}|Z)$/
const toDate = (d, allowTime = false) => {
  const date = new Date(allowTime && isTime.test(d) ? `1970-01-01T${d}Z` : hasTimezone.test(d) ? d : d + 'Z')
  if (Number.isNaN(date.getTime())) throw new Error(`Value does not contain a valid ${allowTime ? 'time' : 'date'} "${d}"`)
  return date
}


class SQLiteService extends SQLService {

  get factory() {
    return {
      options: { max: 1, ...this.options.pool },
      create: tenant => {
        const database = this.url4(tenant)
        const dbc = new sqlite(database, this.options.client)
        const deterministic = { deterministic: true }
        dbc.function('session_context', key => dbc[$session][key])
        dbc.function('regexp', deterministic, (re, x) => (RegExp(re).test(x) ? 1 : 0))
        dbc.function('ISO', deterministic, d => d && new Date(d).toISOString())
        dbc.function('year', deterministic, d => d === null ? null : toDate(d).getUTCFullYear())
        dbc.function('month', deterministic, d => d === null ? null : toDate(d).getUTCMonth() + 1)
        dbc.function('day', deterministic, d => d === null ? null : toDate(d).getUTCDate())
        dbc.function('hour', deterministic, d => d === null ? null : toDate(d, true).getUTCHours())
        dbc.function('minute', deterministic, d => d === null ? null : toDate(d, true).getUTCMinutes())
        dbc.function('second', deterministic, d => d === null ? null : toDate(d, true).getUTCSeconds())
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
      e.message += ' in:\n' + (e.query = sql)
      throw e
    }
  }

  async _run(stmt, binding_params) {
    for (let i = 0; i < binding_params.length; i++) {
      const val = binding_params[i]
      if (val instanceof Readable) {
        binding_params[i] = await convStrm[val.type === 'json' ? 'text' : 'buffer'](val)
      }
      if (Buffer.isBuffer(val)) {
        binding_params[i] = Buffer.from(val.toString('base64'))
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

  pragma (pragma, options) {
    if (!this.dbc) return this.begin('pragma') .then (tx => {
      try { return tx.pragma (pragma, options) }
      finally { tx.release() }
    })
    return this.dbc.pragma (pragma, options)
  }


  exec(sql) {
    return this.dbc.exec(sql)
  }

  _prepareStreams(values) {
    let any
    values.forEach((v, i) => {
      if (v instanceof Readable) {
        any = values[i] = convStrm.buffer(v)
      }
    })
    return any ? Promise.all(values) : values
  }

  async onSIMPLE({ query, data }) {
    const { sql, values } = this.cqn2sql(query, data)
    let ps = await this.prepare(sql)
    const vals = await this._prepareStreams(values)
    return (await ps.run(vals)).changes
  }

  onPlainSQL({ query, data }, next) {
    if (typeof query === 'string') {
      // REVISIT: this is a hack the target of $now might not be a timestamp or date time
      // Add input converter to CURRENT_TIMESTAMP inside views using $now
      if (/^CREATE VIEW.* CURRENT_TIMESTAMP[( ]/is.test(query)) {
        query = query.replace(/CURRENT_TIMESTAMP/gi, "STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')")
      }
    }
    return super.onPlainSQL({ query, data }, next)
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
      if (typeof v.val === 'boolean') v.val = v.val ? 1 : 0
      else if (Buffer.isBuffer(v.val)) v.val = v.val.toString('base64')
      // intercept DateTime values and convert to Date objects to compare ISO Strings
      else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(.\d{1,9})?(Z|[+-]\d{2}(:?\d{2})?)$/.test(v.val)) {
        const date = new Date(v.val)
        if (!Number.isNaN(date.getTime())) {
          v.val = date
        }
      }
      return super.val(v)
    }

    forUpdate() {
      return ''
    }

    forShareLock() {
      return ''
    }

    // Used for INSERT statements
    static InputConverters = {
      ...super.InputConverters,
      // The following allows passing in ISO strings with non-zulu
      // timezones and converts them into zulu dates and times
      Date: e => e === '?' ? e : `strftime('%Y-%m-%d',${e})`,
      Time: e => e === '?' ? e : `strftime('%H:%M:%S',${e})`,
      // Both, DateTimes and Timestamps are canonicalized to ISO strings with
      // ms precision to allow safe comparisons, also to query {val}s in where clauses
      DateTime: e => e === '?' ? e : `ISO(${e})`,
      Timestamp: e => e === '?' ? e : `ISO(${e})`,
    }

    static OutputConverters = {
      ...super.OutputConverters,
      // Structs and arrays are stored as JSON strings; the ->'$' unwraps them.
      // Otherwise they would be added as strings to json_objects.
      Association: expr => `${expr}->'$'`,
      struct: expr => `${expr}->'$'`,
      array: expr => `${expr}->'$'`,
      // SQLite has no booleans so we need to convert 0 and 1
      boolean:
        cds.env.features.sql_simple_queries === 2
          ? undefined
          : expr => `CASE ${expr} when 1 then 'true' when 0 then 'false' END ->'$'`,
      // DateTimes are returned without ms added by InputConverters
      DateTime: e => `substr(${e},0,20)||'Z'`,
      // Timestamps are returned with ms, as written by InputConverters.
      // And as cds.builtin.classes.Timestamp inherits from DateTime we need
      // to override the DateTime converter above
      Timestamp: undefined,
      // int64 is stored as native int64 for best comparison
      // Reading int64 as string to not loose precision
      Int64: cds.env.features.ieee754compatible ? expr => `CAST(${expr} as TEXT)` : undefined,
      // REVISIT: always cast to string in next major
      // Reading decimal as string to not loose precision
      Decimal: cds.env.features.ieee754compatible ? (expr, elem) => elem?.scale
        ? `CASE WHEN ${expr} IS NULL THEN NULL ELSE format('%.${elem.scale}f', ${expr}) END`
        : `CAST(${expr} as TEXT)`
        : undefined,
      // Binary is not allowed in json objects
      Binary: expr => `${expr} || ''`,
    }

    // Used for SQL function expressions
    static Functions = { ...super.Functions, ...require('./cql-functions') }

    // Used for CREATE TABLE statements
    static TypeMap = {
      ...super.TypeMap,
      Binary: e => `BINARY_BLOB(${e.length || 5000})`,
      Date: () => 'DATE_TEXT',
      Time: () => 'TIME_TEXT',
      DateTime: () => 'DATETIME_TEXT',
      Timestamp: () => 'TIMESTAMP_TEXT',
      Map: () => 'JSON_TEXT'
    }

    get is_distinct_from_() {
      return 'is not'
    }
    get is_not_distinct_from_() {
      return 'is'
    }

    static ReservedWords = { ...super.ReservedWords, ...sqliteKeywords }
  }

  // REALLY REVISIT: Here we are doing error handling which we probably never should have started.
  // And worst of all, we handed out this as APIs without documenting it, so stakeholder tests rely
  // on that? -> we urgently need to review these stakeholder tests.
  // And we'd also need this to be implemented by each db service, and therefore documented, correct?
  async onINSERT(req) {
    try {
      return await super.onINSERT(req)
    } catch (err) {
      throw _not_unique(err, 'ENTITY_ALREADY_EXISTS', req.data)
    }
  }

  async onUPDATE(req) {
    try {
      return await super.onUPDATE(req)
    } catch (err) {
      throw _not_unique(err, 'UNIQUE_CONSTRAINT_VIOLATION', req.data)
    }
  }
}

// function _not_null (err) {
//   if (err.code === "SQLITE_CONSTRAINT_NOTNULL") return Object.assign (err, {
//     code: 'MUST_NOT_BE_NULL',
//     target: /\.(.*?)$/.exec(err.message)[1], // here we are even constructing OData responses, with .target
//     message: 'Value is required',
//   })
// }

function _not_unique(err, code, data) {
  if (err.message.match(/unique constraint/i))
    return Object.assign(err, {
      originalMessage: err.message, // FIXME: required because of next line
      message: code, // FIXME: misusing message as code
      code: 400, // FIXME: misusing code as (http) status
    })
  if (data) err.values = SANITIZE_VALUES ? ['***'] : data
  return err
}

module.exports = SQLiteService
