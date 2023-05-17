const { SQLService } = require('@cap-js/db-service')
const { Readable } = require('stream')
const cds = require('@sap/cds/lib')
const sqlite = require('better-sqlite3')
const $session = Symbol('dbc.session')

class SQLiteService extends SQLService {
  get factory() {
    return {
      options: { max: 1, ...this.options.pool },
      create: tenant => {
        const database = this.url4(tenant)
        const dbc = new sqlite(database)
        dbc.function('SESSION_CONTEXT', key => dbc[$session][key])
        dbc.function('REGEXP', { deterministic: true }, (re, x) => (RegExp(re).test(x) ? 1 : 0))
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
    if (!dbc[$session]) {
      dbc[$session] = variables // initial call from within this.begin()
      const $super = this._release
      this._release = function (dbc) {
        // reset session on release
        delete dbc[$session]
        return $super.call(this, dbc)
      }
    } else Object.assign(dbc[$session], variables) // subsequent uses from custom code
  }

  prepare(sql) {
    try {
      return this.dbc.prepare(sql)
    } catch (e) {
      e.message += ' in:\n' + (e.sql = sql)
      throw e
    }
  }

  exec(sql) {
    return this.dbc.exec(sql)
  }

  static CQN2SQL = class CQN2SQLite extends SQLService.CQN2SQL {
    SELECT_columns({ SELECT }) {
      if (!SELECT.columns) return '*'
      const { orderBy } = SELECT
      const orderByMap = {}
      // Collect all orderBy columns that should be taken from the SELECT.columns
      if (Array.isArray(orderBy))
        orderBy?.forEach(o => {
          if (o.ref?.length === 1) {
            orderByMap[o.ref[0]] = true
          }
        })
      return SELECT.columns.map(x => {
        const alias = this.column_name(x)
        // Check whether the column alias should be added
        const xpr = this.column_expr(x)
        const needsAlias = (typeof x.as === 'string' && x.as) || orderByMap[alias]
        return `${xpr}${needsAlias ? ` as ${this.quote(alias)}` : ''}`
      })
    }

    operator(x, i, xpr) {
      if (x === '=' && xpr[i + 1]?.val === null) return 'is'
      if (x === '!=') return 'is not'
      else return x
    }

    // Used for INSERT statements
    static InputConverters = {
      ...super.InputConverters,
      Date: e => `strftime('%Y-%m-%d',${e})`,
      Time: e => `strftime('%H:%M:%S',${e})`,
      DateTime: e => `strftime('%Y-%m-%dT%H:%M:%SZ',${e})`,
      Timestamp: e => `strftime('%Y-%m-%dT%H:%M:%fZ',${e})`,
    }

    static OutputConverters = {
      ...super.OutputConverters,
      boolean: expr => `CASE ${expr} when 1 then 'true' when 0 then 'false' END ->'$'`, // REVIEW: ist that correct?
      Int64: expr => `CAST(${expr} as TEXT)`, // REVISIT: As discussed: please put that on a list of things to revisit later on
      Decimal: expr => `nullif(quote(${expr}),'NULL')->'$'`, // REVISIT: what is that ->'$' doing?
      Float: expr => `nullif(quote(${expr}),'NULL')->'$'`,
      Double: expr => `nullif(quote(${expr}),'NULL')->'$'`,
      struct: expr => `${expr}->'$'`, // Association + Composition inherits from struct
      array: expr => `${expr}->'$'`,
      // REVISIT: Timestamp should not loos precision
      Date: e => `strftime('%Y-%m-%d',${e})`,
      Time: e => `strftime('%H:%M:%S',${e})`,
      DateTime: e => `strftime('%Y-%m-%dT%H:%M:%SZ',${e})`,
      Timestamp: e => `strftime('%Y-%m-%dT%H:%M:%fZ',${e})`,
    }

    // Used for SQL function expressions
    static Functions = { ...super.Functions }

    // Used for CREATE TABLE statements
    static TypeMap = {
      ...super.TypeMap,
      Binary: e => `BINARY_BLOB(${e.length || 5000})`,
      Date: () => 'DATE_TEXT',
      Time: () => 'TIME_TEXT',
      DateTime: () => 'TIMESTAMP_TEXT',
      Timestamp: () => 'TIMESTAMP_TEXT',
    }

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

  // overrides generic onSTREAM
  // SQLite doesn't support streaming, the whole data is read from/written into the database
  async onSTREAM(req) {
    const { sql, values, entries } = this.cqn2sql(req.query)
    // writing stream
    if (req.query.STREAM.into) {
      values.unshift(await this.STREAM_data(entries[0][0]))
      const ps = await this.prepare(sql)
      return (await ps.run(values)).changes
    }
    // reading stream
    const ps = await this.prepare(sql)
    let result = await ps.all(values)
    if (result.length === 0) cds.error`Entity "${req.query.STREAM.from.ref[0]}" with entered keys is not found`
    const val = Object.values(result[0])[0]
    if (val === null) return val
    const stream_ = new Readable()
    stream_.push(val)
    stream_.push(null)
    return stream_
  }

  STREAM_data(value) {
    return new Promise((resolve, reject) => {
      const chunks = []
      value.on('data', chunk => chunks.push(chunk))
      value.on('end', () => resolve(Buffer.concat(chunks)))
      value.on('error', err => {
        value.removeAllListeners('error')
        reject(err)
      })
    })
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
