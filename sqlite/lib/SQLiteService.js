const { SQLService } = require('@cap-js/db-service')
const cds = require('@sap/cds/lib')
let sqlite // sqlite driver is loaded on connect

const $session = Symbol('dbc.session')
const sessionVariableMap = require('./session.json')  // Adjust the path as necessary for your project
const convStrm = require('stream/consumers')
const { Readable } = require('stream')

const keywords = cds.compiler.to.sql.sqlite.keywords
// keywords come as array
const sqliteKeywords = keywords.reduce((prev, curr) => {
  prev[curr] = 1
  return prev
}, {})

class SQLiteService extends SQLService {

  get factory() {
    return {
      options: this.options.pool || {},
      create: async tenant => {
        try {
          if (!sqlite) loadSQLite(this.options.driver || this.options.credentials?.driver)
          const database = this.url4(tenant)
          const dbc = new sqlite(database, this.options.client || {})
          await dbc.ready

          if (!SQLiteService._aiEmbeddingChecked) {
            SQLiteService._aiEmbeddingChecked = true
            try {
              const aiPlugin = await import('@cap-js/ai/lib/vector_embedding/index.js')
              SQLiteService._aiEmbedding = aiPlugin.vector_embedding
            } catch {}
          }

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
          dbc.function('COSINE_SIMILARITY', deterministic, (a, b) => cosineSimilarity(toFloatArray(a), toFloatArray(b)))
          dbc.function('L2DISTANCE', deterministic, (a, b) => l2Distance(toFloatArray(a), toFloatArray(b)))
          dbc.function('L2NORMALIZE', deterministic, v => v == null ? null : fromFloatArray(l2Normalize(toFloatArray(v)), v))
          dbc.function('VECTOR_EMBEDDING', deterministic, (input, text_type, model_and_version) => {
            if (input == null) return null
            if (SQLiteService._aiEmbedding) {
              try { return SQLiteService._aiEmbedding(input, text_type, model_and_version) }
              catch {}
            }
            return JSON.stringify(hashEmbedding(String(input)))
          })
          if (database !== ':memory:') dbc.pragma?.('journal_mode = WAL') || dbc.exec('PRAGMA journal_mode = WAL')
          return dbc
        } catch (err) {
          Promise.reject(err)
          await new Promise(() => { })
        }
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

    // Enrich provided session context with aliases
    for (const alias in sessionVariableMap) {
      const name = sessionVariableMap[alias]
      if (variables[name]) variables[alias] = variables[name]
    }

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
        stream: (..._) => this._allStream(stmt, ..._),
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

  async *_iteratorRaw(rs, one) {
    const pageSize = (1 << 16)
    // Allow for both array and iterator result sets
    const first = Array.isArray(rs) ? { done: !rs[0], value: rs[0] } : rs.next()
    if (first.done) {
      yield one ? 'null' : '[]'
      return
    }
    if (one) {
      yield first.value[0]
      // Close result set to release database connection
      rs.return()
      return
    }

    let buffer = '[' + first.value[0]
    // Print first value as stand alone to prevent comma check inside the loop
    for (const row of rs) {
      buffer += `,${row[0]}`
      if (buffer.length > pageSize) {
        yield buffer
        buffer = ''
      }
    }
    buffer += ']'
    yield buffer
  }

  async *_iteratorObjectMode(rs) {
    for (const row of rs) {
      yield JSON.parse(row[0])
    }
  }

  async _allStream(stmt, binding_params, one, objectMode) {
    stmt = stmt.iterate ? stmt : stmt.__proto__
    stmt.raw?.(true)
    const rs = stmt.iterate(binding_params)
    const stream = Readable.from(objectMode ? this._iteratorObjectMode(rs) : this._iteratorRaw(rs, one), { objectMode })
    const close = () => rs.return() // finish result set when closed early
    stream.on('error', close)
    stream.on('close', close)
    return stream
  }

  pragma(pragma, options) {
    if (!this.dbc) return this.begin('pragma').then(tx => {
      try { return tx.pragma(pragma, options) }
      finally { tx.release() }
    })
    return this.dbc.pragma(pragma, options)
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
    const { changes } = await ps.run(vals)
    return this._return_affected (changes)
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
      Decimal: cds.env.features.ieee754compatible
        ? (expr, elem) =>
            elem?.scale
              ? `CASE WHEN ${expr} IS NULL THEN NULL ELSE format('%.${elem.scale}f', ${expr}) END`
              : `CASE WHEN ${expr} IS NULL THEN NULL ELSE rtrim(rtrim(format('%.999f', ${expr}), '0'), '.') END`
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
      Map: () => 'JSON_TEXT',
      Decimal: cds.env.requires.db?.decimal_affinity?.match(/^real$/i) ? () => 'REAL_DECIMAL' : undefined,
    }

    get is_distinct_from_() {
      return 'is not'
    }
    get is_not_distinct_from_() {
      return 'is'
    }

    static ReservedWords = { ...super.ReservedWords, ...sqliteKeywords }
  }
}

function loadSQLite(driver) {
  const drivers = {
    node: './node-sqlite.js',
    'better-sqlite3': 'better-sqlite3',
    'sql.js': './sql.js.js',
  }

  if (driver) {
    sqlite = require(drivers[driver])
  } else {
    sqlite = require(drivers.node)
  }
}

// define date and time functions in js to allow for throwing errors
const isTime = /^\d{1,2}:\d{1,2}:\d{1,2}$/
const hasTimezone = /([+-]\d{1,2}:?\d{0,2}|Z)$/
const toDate = (d, allowTime = false) => {
  const date = new Date(allowTime && isTime.test(d) ? `1970-01-01T${d}Z` : hasTimezone.test(d) ? d : d + 'Z')
  if (Number.isNaN(date.getTime())) throw new Error(`Value does not contain a valid ${allowTime ? 'time' : 'date'} "${d}"`)
  return date
}

// Vector functions implemented in JavaScript for SQLite (registered as custom SQL functions)
function cosineSimilarity(a, b) {
  if (a == null || b == null) return null
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

function l2Distance(a, b) {
  if (a == null || b == null) return null
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

function l2Normalize(v) {
  if (v == null) return null
  let norm = 0
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i]
  if (norm === 0) return v
  norm = Math.sqrt(norm)
  for (let i = 0; i < v.length; i++) v[i] /= norm
  return v
}

/**
 * Deterministic synchronous hash-based embedding function for SQLite.
 * NOTE: If a synchronous embedding library becomes available for Node.js,
 * it can be integrated here to replace the hash-based implementation.
 */
function hashEmbedding(text, dimensions = 384) {
  if (text == null) return null
  const vector = new Float32Array(dimensions)
  const normalized = text.toLowerCase()
  const ngramSize = 3

  if (normalized.length >= ngramSize) {
    for (let i = 0; i <= normalized.length - ngramSize; i++)
      project(ngramHash(normalized, i, ngramSize), vector, dimensions)
  } else {
    for (let i = 0; i < normalized.length; i++)
      project(normalized.charCodeAt(i), vector, dimensions)
  }
  return Array.from(l2Normalize(vector))
}

function ngramHash(text, start, len) {
  let hash = 0x811c9dc5
  for (let i = start; i < start + len; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash
}

function project(hash, vector, dimensions) {
  for (let band = 0; band < 4; band++) {
    const h = rehash(hash, band)
    vector[Math.abs(h % dimensions)] += ((h >>> 16) & 1) === 0 ? 1.0 : -1.0
  }
}

function rehash(hash, band) {
  let h = hash ^ Math.imul(band, 0x9e3779b9)
  h ^= h >>> 16
  h = Math.imul(h, 0x45d9f3b)
  h ^= h >>> 16
  return h
}

// Vector type conversion helpers for SQLite - handle various input formats (Buffer, string, array, typed arrays)
function toFloatArray(vector) {
  if (vector == null) return null
  if (vector instanceof Float32Array) return Array.from(vector)
  if (Buffer.isBuffer(vector)) return JSON.parse(vector.toString('utf8'))
  if (vector instanceof Uint8Array) return JSON.parse(Buffer.from(vector).toString('utf8'))
  if (typeof vector === 'string') return JSON.parse(vector)
  if (Array.isArray(vector)) return vector
  throw new Error(`Unsupported vector type: ${typeof vector}`)
}

function fromFloatArray(arr, original) {
  return original instanceof Float32Array ? new Float32Array(arr) : JSON.stringify(arr)
}

module.exports = SQLiteService
