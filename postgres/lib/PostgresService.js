const { SQLService } = require('@cap-js/db-service')
const { Client, Query } = require('pg')
const cds = require('@sap/cds')
const crypto = require('crypto')
const { Writable, Readable } = require('stream')
const sessionVariableMap = require('./session.json')

class PostgresService extends SQLService {
  init() {
    if (!this.options.independentDeploy) {
      // REVISIT: injects dialect into cds.deploy logic
      cds.options = cds.options || {}
      cds.options.dialect = 'postgres'
    }
    this.kind = 'postgres'
    this._queryCache = {}
    return super.init(...arguments)
  }

  get factory() {
    return {
      options: this.options.pool || {},
      create: async () => {
        const { credentials: cr = {}, client: clientOptions = {} } = this.options
        const credentials = {
          // Cloud Foundry provides the user in the field username the pg npm module expects user
          user: cr.username || cr.user,
          password: cr.password,
          // Special handling for:
          // BTP - Cloud Foundry - PostgreSQL Hyperscaler Service
          host: cr.hostname || cr.host,
          port: cr.port || process.env.PGPORT || 5432,
          database: cr.dbname || cr.database,
          schema: cr.schema,
          sslRequired: cr.sslrootcert && (cr.sslrootcert ?? true),
          // from pg driver docs:
          // passed directly to node.TLSSocket, supports all tls.connect options
          ssl:
            cr.ssl /* enable pg module setting to connect to Azure postgres */ ||
            (cr.sslrootcert && {
              rejectUnauthorized: false,
              ca: cr.sslrootcert,
            }),
        }
        const dbc = new Client({ ...credentials, ...clientOptions })
        await dbc.connect()
        dbc.open = true
        dbc.on('end', () => { dbc.open = false })
        return dbc
      },
      destroy: dbc => dbc.end(),
      validate: dbc => dbc.open,
    }
  }

  url4() {
    // TODO: Maybe log which database and which user? Be more robust against missing properties?
    let { host, hostname, port } = this.options?.credentials || this.options || {}
    return (hostname || host) + ':' + (port || 5432)
  }

  async set(variables) {
    // RESTRICTIONS: 'Custom parameter names must be two or more simple identifiers separated by dots.'
    const env = {}

    // Check all properties on the variables object
    for (let name in variables) {
      env[sessionVariableMap[name] || name] = variables[name]
    }

    // Explicitly check for the default session variable properties
    // As they are getters and not own properties of the object
    for (let name in sessionVariableMap) {
      if (variables[name]) env[sessionVariableMap[name]] = variables[name]
    }

    return Promise.all([
      (await this.prepare(`SELECT set_config(key::text,$1->>key,false) FROM jsonb_each($1);`)).run([
        JSON.stringify(env),
      ]),
      ...(this.options?.credentials?.schema
        ? [this.exec(`SET search_path TO "${this.options?.credentials?.schema}";`)]
        : []),

      ...(!this._initalCollateCheck ? [this._checkCollation()] : []),
    ])
  }

  async _checkCollation() {
    this._initalCollateCheck = true

    const icuPrep = await this.prepare(`SELECT collname FROM pg_collation WHERE collname = 'en-x-icu';`)
    const icuResp = await icuPrep.all([])

    if (icuResp.length > 0) {
      this.class.CQN2SQL.prototype.orderBy = this.class.CQN2SQL.prototype.orderByICU
      return
    }

    /**
     * Selects the first two characters of the collation name as key
     * Select the smallest collation name as value (could also be max)
     * Filter the collations by the provider c (libc)
     * Filters the collation names by /.._../ Where '>' points at the '_' that is an actual '_'
     * The group by is done by the key column to make sure that only one collation per key is returned
     */
    const cSQL = `
SELECT
  SUBSTRING(collname, 1, 2) AS K,
  MIN(collname) AS V
FROM
  pg_collation
WHERE
  collprovider = 'c' AND
  collname LIKE '__>___' ESCAPE '>'
GROUP BY k
`

    const cPrep = await this.prepare(cSQL)
    const cResp = await cPrep.all([])
    if (cResp.length > 0) {
      const collationMap = (this.class.CQN2SQL.prototype.collationMap = cResp.reduce((ret, row) => {
        ret[row.k] = row.v
        return ret
      }, {}))
      collationMap.default = collationMap.en || collationMap[Object.keys(collationMap)[0]]
      this.class.CQN2SQL.prototype.orderBy = this.class.CQN2SQL.prototype.orderByLIBC
      return
    }

    // REVISIT: print a warning when no collation is found
  }

  prepare(sql) {
    // Track queries name for postgres referencing prepare statements
    // sha1 as it needs to be less then 63 character
    const sha = crypto.createHash('sha1').update(sql).digest('hex')
    const query = this._queryCache[sha] = this._queryCache[sha] || {
      _streams: 0,
      text: sql,
      name: sha,
    }

    const enhanceError = (err, sql) => Object.assign(err, { query: sql + '\n' + new Array(err.position).fill(' ').join('') + '^' })

    return {
      run: async values => {
        try {
          // REVISIT: SQLService provides empty values as {} for plain SQL statements - PostgreSQL driver expects array or nothing - see issue #78
          let newQuery = this._prepareStreams(query, values)
          if (typeof newQuery.then === 'function') newQuery = await newQuery
          const result = await this.dbc.query(newQuery)
          return { changes: result.rowCount }
        } catch (e) {
          throw enhanceError(e, sql)
        }
      },
      get: async values => {
        try {
          // REVISIT: SQLService provides empty values as {} for plain SQL statements - PostgreSQL driver expects array or nothing - see issue #78
          const result = await this.dbc.query({ ...query, values: this._getValues(values) })
          return result.rows[0]
        } catch (e) {
          throw enhanceError(e, sql)
        }
      },
      all: async values => {
        // REVISIT: SQLService provides empty values as {} for plain SQL statements - PostgreSQL driver expects array or nothing - see issue #78
        try {
          const result = await this.dbc.query({ ...query, values: this._getValues(values) })
          return result.rows
        } catch (e) {
          throw enhanceError(e, sql)
        }
      },
      stream: async (values, one, objectMode) => {
        try {
          const streamQuery = new QueryStream({ ...query, values: this._getValues(values) }, one, objectMode)
          return await this.dbc.query(streamQuery)
        } catch (e) {
          throw enhanceError(e, sql)
        }
      },
    }
  }

  _getValues(values) {
    // empty values
    if (!values || Object.keys(values).length === 0) return null
    // values are already in array form
    if (Array.isArray(values)) return values
    return values
  }

  _prepareStreams(query, values) {
    values = this._getValues(values)
    if (!values) return query

    const streams = []
    const newValues = []
    let sql = query.text
    if (Array.isArray(values)) {
      values.forEach((value, i) => {
        if (value instanceof Readable) {
          const streamID = query._streams++
          const isBinary = value.type !== 'json'
          const paramStream = new ParameterStream(query.name, streamID)
          if (isBinary) value.setEncoding('base64')
          value.pipe(paramStream)
          value.on('error', err => paramStream.emit('error', err))
          streams.push(paramStream)
          newValues[i] = streamID
          sql = sql.replace(
            new RegExp(`\\$${i + 1}`, 'g'),
            // Don't ask about the dollar signs
            `(SELECT ${isBinary ? `DECODE(PARAM,'base64')` : 'PARAM'} FROM "$$$$PARAMETER_BUFFER$$$$" WHERE NAME='${query.name
            }' AND ID=$${i + 1})`,
          )
          return
        }
        newValues[i] = value
      })
    }

    if (streams.length > 0) {
      return (async () => {
        const newQuery = {
          text: sql,
          // Even with the changed SQL it might be common to call this statement with the same parameters as streams
          // As the streams are selected with their ID as prepared statement parameter, the sql is the same
          name: crypto.createHash('sha1').update(sql).digest('hex'),
          values: newValues,
        }
        await this.dbc.query({
          text: 'CREATE TEMP TABLE IF NOT EXISTS "$$PARAMETER_BUFFER$$" (PARAM TEXT, NAME TEXT, ID INT) ON COMMIT DROP',
        })
        const proms = []
        for (const stream of streams) {
          proms.push(this.dbc.query(stream))
        }
        await Promise.all(proms)
        return newQuery
      })()
    }
    return { ...query, values }
  }

  async exec(sql) {
    return this.dbc.query(sql)
  }

  async onPlainSQL(req, next) {
    const query = req.query
    if (this.options.independentDeploy) {
      // REVISIT: Should not be needed when deployment supports all types or sends CQNs
      // Rewrite drop statements
      if (/^DROP (TABLE|VIEW)/.test(query)) {
        // Extracts the name from the incoming SQL statment
        const name = query.match(/^DROP (TABLE|VIEW) IF EXISTS ("[^"]+"|[^\s;]+)/im)[2]
        // Replaces all '_' with '.' from left to right
        const split = name.split('_')
        const options = split.map((_, i) => split.slice(0, i + 1).join('.') + '.' + split.slice(i + 1).join('_'))
        // Finds the first match inside the model
        const target = options.find(n => this.model.definitions[n])
        // If the entity was found in the model it is dropped using CQN
        return target && this.run(cds.ql.DROP(target))
      }

      // Rewrite create statements
      if (/^CREATE (TABLE|VIEW)/.test(query)) {
        // Extracts the name from the incoming SQL statment
        const name = query.match(/^CREATE (TABLE|VIEW) ("[^"]+"|[^\s(]+)/im)[2]
        // Replaces all '_' with '.' from left to right
        const split = name.split('_')
        const options = split.map((_, i) => split.slice(0, i + 1).join('.') + '.' + split.slice(i + 1).join('_'))
        // Finds the first match inside the model
        const target = options.find(n => this.model.definitions[n])
        // If the entity was found in the model it is dropped using CQN
        return target && this.run(cds.ql.CREATE(target))
      }
    }

    try {
      return await super.onPlainSQL(req, next)
    }
    catch (err) {
      if (err.code === '3F000') {
        if (this.options?.credentials?.schema) {
          cds.error`Failed to configure schema ("${this.options?.credentials?.schema}") before plainSQL call: ${req.query}`
        } else {
          cds.error`No schema was configure / detected before plainSQL call: ${req.query}`
        }
      }
      throw err
    }
  }

  async onSELECT(req) {
    const { query, data } = req
    // workaround for chunking odata streaming
    if (query.SELECT?.columns?.find(col => col.as === '$mediaContentType')) {
      const columns = query.SELECT.columns
      const index = columns.findIndex(col => query.elements[col.ref?.[col.ref.length - 1]].type === 'cds.LargeBinary')
      const binary = columns.splice(index, 1)
      // SELECT without binary column
      let res = await super.onSELECT({ query, data })
      if (!res) return res
      // SELECT only binary column
      query.SELECT.columns = binary
      const { sql: streamSql, values: valuesStream } = this.cqn2sql(query, data)
      const ps = this.prepare(streamSql)
      const stream = await ps.stream(valuesStream, true)
      // merge results
      res[this.class.CQN2SQL.prototype.column_name(binary[0])] = stream
      return res
    }
    return super.onSELECT(req)
  }


  static CQN2SQL = class CQN2Postgres extends SQLService.CQN2SQL {

    render_with() {
      const sql = this.sql
      let recursive = false
      const prefix = this._with.map(q => {
        let sql
        if ('SELECT' in q) sql = `${this.quote(q.as)} AS (${this.SELECT(q)})`
        else if ('SET' in q) {
          recursive = true
          const { SET } = q
          const isDepthFirst = SET.orderBy?.length && (SET.orderBy[0].sort?.toLowerCase() === 'desc' || SET.orderBy[0].sort === -1)
          let alias = q.as
          if (isDepthFirst) {
            alias = alias + '_depth_first'
            SET.args[1].SELECT.from.args.forEach(r => { if (r.ref[0] === q.as) r.ref[0] = alias })
          }

          sql = `${this.quote(alias)}(${SET.args[0].SELECT.columns?.map(c => this.quote(this.column_name(c))) || ''}) AS (${
            // Root select
            this.SELECT(SET.args[0])} ${
            // Union clause
            SET.op?.toUpperCase() || 'UNION'} ${SET.all ? 'ALL' : ''} ${
            // Repeated join query
            this.SELECT(SET.args[1])
            })${
            // Leverage Postgres specific depth first syntax
            SET.orderBy?.length
              ? ` SEARCH DEPTH FIRST BY ${SET.orderBy.map(r => this.ref(r))} SET "$DEPTH$"`
              : ''
            }`

          // Enforce depth sorting for consuming queries
          if (isDepthFirst) sql += `,${this.quote(q.as)} AS (SELECT * FROM ${this.quote(q.as + '_depth_first')} ORDER BY "$DEPTH$")`
        }
        return { sql }
      })
      this.sql = `WITH${recursive ? ' RECURSIVE' : ''} ${prefix.map(p => p.sql)} ${sql}`
    }

    _orderBy(orderBy, localized, locale) {
      return orderBy.map(c => {
        const nulls = c.nulls || (c.sort?.toLowerCase() === 'desc' || c.sort === -1 ? 'LAST' : 'FIRST')
        const o = localized
          ? this.expr(c) +
          (c.element?.[this.class._localized] && locale ? ` COLLATE "${locale}"` : '') +
          (c.sort?.toLowerCase() === 'desc' || c.sort === -1 ? ' DESC' : ' ASC')
          : this.expr(c) + (c.sort?.toLowerCase() === 'desc' || c.sort === -1 ? ' DESC' : ' ASC')
        return o + ' NULLS ' + (nulls.toLowerCase() === 'first' ? 'FIRST' : 'LAST')
      })
    }

    orderBy(orderBy) {
      return this._orderBy(orderBy)
    }

    orderByICU(orderBy, localized) {
      const locale = this.context.locale ? `${this.context.locale.replace('_', '-')}-x-icu` : this.context.locale
      return this._orderBy(orderBy, localized, locale)
    }

    orderByLIBC(orderBy, localized) {
      const locale = this.collationMap[this.context.locale] || this.collationMap.default
      return this._orderBy(orderBy, localized && locale, locale)
    }

    from(from) {
      if (from.ref?.[0] === 'sqlite.schema') {
        return '(SELECT table_name as name from information_schema.tables where table_schema = current_schema()) as schema'
      }
      // REVISIT: postgres always needs an alias for sub selects
      if (from.SELECT && !from.as) from.as = from.SELECT.as || 'unknown'
      return super.from(from)
    }

    column_alias4(x, q) {
      if (!x.as && 'val' in x) return String(x.val)
      return super.column_alias4(x, q)
    }

    SELECT_expand(q, sql) {
      const { SELECT } = q
      if (!SELECT.columns) return sql
      const queryAlias = this.quote(SELECT.from?.as || (SELECT.expand === 'root' && 'root'))
      const cols = SELECT.columns.map(x => {
        const name = this.column_name(x)
        const outputConverter = this.output_converter4(x.element, `${queryAlias}.${this.quote(name)}`)
        return `${outputConverter} as ${this.doubleQuote(name)}`
      })
      const isRoot = SELECT.expand === 'root'
      const isSimple = cds.env.features.sql_simple_queries &&
        isRoot && // Simple queries are only allowed to have a root
        !Object.keys(q.elements).some(e =>
          q.elements[e].isAssociation || // Indicates columns contains an expand
          q.elements[e].$assocExpand || // REVISIT: sometimes associations are structs
          q.elements[e].items // Array types require to be inlined with a json result
        )

      const subQuery = `SELECT ${cols} FROM (${sql}) as ${queryAlias}`
      if (isSimple) return subQuery

      // REVISIT: Remove SELECT ${cols} by adjusting SELECT_columns
      let obj = `to_jsonb(${queryAlias}.*)`
      return `SELECT ${SELECT.one || isRoot ? obj : `coalesce(jsonb_agg (${obj}),'[]'::jsonb)`
        } as _json_ FROM (${subQuery}) as ${queryAlias}`
    }

    doubleQuote(name) {
      return `"${name.replace(/"/g, '""')}"`
    }

    INSERT(q, isUpsert = false) {
      super.INSERT(q, isUpsert)

      // REVISIT: this should probably be made a bit easier to adopt
      return (this.sql = this.sql
        // Adjusts json function to be postgres specific
        .replace('json_each(?)', 'json_array_elements($1::json)')
      )
    }

    UPSERT(q, isUpsert = false) {
      super.UPSERT(q, isUpsert)

      // REVISIT: this should probably be made a bit easier to adopt
      return (this.sql = this.sql
        // Adjusts json function to be postgres specific
        .replace('json_each(?)', 'json_array_elements($1::json)')
      )
    }

    managed_extract(name, element, converter) {
      const { UPSERT, INSERT } = this.cqn
      const extract = !(INSERT?.entries || UPSERT?.entries) && (INSERT?.rows || UPSERT?.rows)
        ? `value->>${this.columns.indexOf(name)}`
        : `value->>'${name.replace(/'/g, "''")}'`
      const sql = converter?.(extract) || extract
      return { extract, sql }
    }

    managed_default(name, managed, src) {
      return `(CASE WHEN json_typeof(value->${this.managed_extract(name).extract.slice(8)}) IS NULL THEN ${managed} ELSE ${src} END)`
    }

    param({ ref }) {
      this._paramCount = this._paramCount || 1
      if (ref.length > 1) throw cds.error`Unsupported nested ref parameter: ${ref}`
      return ref[0] === '?' ? `$${this._paramCount++}` : `:${ref}`
    }

    val(val) {
      const ret = super.val(val)
      return ret === '?' ? `$${this.values.length}` : ret
    }

    operator(x, i, xpr) {
      if (x === 'regexp') return '~'
      else return super.operator(x, i, xpr)
    }

    // Postgres does not support locking columns only tables which makes of unapplicable
    // Postgres does not support "wait n" it only supports "nowait"
    forUpdate(update) {
      const { wait, ignoreLocked } = update
      let sql = 'FOR UPDATE'
      if (wait === 0) sql += ' NOWAIT'
      if (ignoreLocked) sql += ' SKIP LOCKED'
      return sql
    }

    forShareLock(lock) {
      const { wait } = lock
      if (wait === 0) return 'FOR SHARE NOWAIT'
      return 'FOR SHARE'
    }

    // Postgres requires own quote function, becuase the effective name is lower case
    quote(s) {
      if (typeof s !== 'string') return '"' + s + '"'
      if (s.includes('"')) return '"' + s.replace(/"/g, '""').toLowerCase() + '"'
      if (s in this.class.ReservedWords || !/^[A-Za-z_][A-Za-z_$0-9]*$/.test(s)) return '"' + s.toLowerCase() + '"'
      return s
    }

    defaultValue(defaultValue = this.context.timestamp.toISOString()) {
      return typeof defaultValue === 'string' ? this.string(`${defaultValue}`) : defaultValue
    }

    static Functions = { ...super.Functions, ...require('./cql-functions') }

    static ReservedWords = { ...super.ReservedWords, ...require('./ReservedWords.json') }

    static TypeMap = {
      ...super.TypeMap,
      // REVISIT: check whether we should use native UUID support
      UUID: () => `VARCHAR(36)`,
      UInt8: () => `INT`,
      String: e => `VARCHAR(${e.length || 5000})`,
      Binary: () => `BYTEA`,
      Double: () => 'FLOAT8',
      LargeString: () => 'TEXT',
      LargeBinary: () => 'BYTEA',
      array: () => 'TEXT',
      Time: () => 'TIME',
      DateTime: () => 'TIMESTAMP',
      Timestamp: () => 'TIMESTAMP',
      Map: () => 'JSONB',

      // HANA Types
      'cds.hana.CLOB': () => 'BYTEA',
      'cds.hana.BINARY': () => 'BYTEA',
      'cds.hana.TINYINT': () => 'SMALLINT',
      'cds.hana.ST_POINT': () => 'POINT',
      'cds.hana.ST_GEOMETRY': () => 'POLYGON',
    }

    // Used for INSERT statements
    static InputConverters = {
      ...super.InputConverters,
      // UUID: (e) => e[0] === '$' ? e : `CAST(${e} as UUID)`, // UUID is strict in formatting sflight does not comply
      boolean: e => e[0] === '$' ? e : `CASE ${e} WHEN 'true' THEN true WHEN 'false' THEN false END`,
      // REVISIT: Postgres and HANA round Decimal numbers differently therefore precision and scale are removed
      // Float: (e, t) => e[0] === '$' ? e : `CAST(${e} as decimal${t.precision && t.scale ? `(${t.precision},${t.scale})` : ''})`,
      // Decimal: (e, t) => e[0] === '$' ? e : `CAST(${e} as decimal${t.precision && t.scale ? `(${t.precision},${t.scale})` : ''})`,
      Float: e => e[0] === '$' ? e : `CAST(${e} as decimal)`,
      Decimal: e => e[0] === '$' ? e : `CAST(${e} as decimal)`,
      Integer: e => e[0] === '$' ? e : `CAST(${e} as integer)`,
      Int64: e => e[0] === '$' ? e : `CAST(${e} as bigint)`,
      Date: e => e[0] === '$' ? e : `CAST(${e} as DATE)`,
      Time: e => e[0] === '$' ? e : `CAST(${e} as TIME)`,
      DateTime: e => e[0] === '$' ? e : `CAST(${e} as TIMESTAMP)`,
      Timestamp: e => e[0] === '$' ? e : `CAST(${e} as TIMESTAMP)`,
      // REVISIT: Remove that with upcomming fixes in cds.linked
      Double: (e, t) => e[0] === '$' ? e : `CAST(${e} as decimal${t.precision && t.scale ? `(${t.precision},${t.scale})` : ''})`,
      DecimalFloat: (e, t) => e[0] === '$' ? e : `CAST(${e} as decimal${t.precision && t.scale ? `(${t.precision},${t.scale})` : ''})`,
      Binary: e => e[0] === '$' ? e : `DECODE(${e},'base64')`,
      LargeBinary: e => e[0] === '$' ? e : `DECODE(${e},'base64')`,
      Map: e => e[0] === '$' ? e : `CAST(${e} as jsonb)`,

      // HANA Types
      'cds.hana.CLOB': e => e[0] === '$' ? e : `DECODE(${e},'base64')`,
      'cds.hana.BINARY': e => e[0] === '$' ? e : `DECODE(${e},'base64')`,
      // REVISIT: have someone take a look at how this syntax exactly works in postgres with postgis
      'cds.hana.ST_POINT': e => `(${e})::point`,
      'cds.hana.ST_GEOMETRY': e => `(${e})::polygon`,
    }

    static OutputConverters = {
      ...super.OutputConverters,
      Binary: e => `ENCODE(${e},'base64')`,
      LargeBinary: e => `ENCODE(${e},'base64')`,
      Date: e => `to_char(${e}, 'YYYY-MM-DD')`,
      Time: e => `to_char(${e}, 'HH24:MI:SS')`,
      DateTime: e => `to_char(${e}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
      Timestamp: e => `to_char(${e}, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')`,
      UTCDateTime: e => `to_char(${e}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
      UTCTimestamp: e => `to_char(${e}, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')`,
      Association: e => `jsonb(${e})`,
      struct: e => `jsonb(${e})`,
      array: e => `jsonb(${e})`,
      // Reading int64 as string to not loose precision
      Int64: cds.env.features.ieee754compatible ? expr => `cast(${expr} as varchar)` : undefined,
      // REVISIT: always cast to string in next major
      // Reading decimal as string to not loose precision
      Decimal: cds.env.features.ieee754compatible ? (expr, elem) => elem?.scale
        ? `to_char(${expr},'FM${'0'.padStart(elem.precision, '9')}${'D'.padEnd(elem.scale + 1, '0')}')`
        : `cast(${expr} as varchar)`
        : undefined,

      // Convert ST types back to WKT format
      'cds.hana.ST_POINT': expr => `ST_AsText(${expr})`,
    }
  }

  // REVISIT: find good names database/tenant/schema/instance
  async database({ database }) {
    const creds = {
      database: database,
      usergroup: `${database}_USERS`,
      user: `${database}_USER_MANAGER`,
    }
    creds.password = creds.user

    const system = cds.requires.db.credentials

    try {
      const con = await this.factory.create(system)
      this.dbc = con
      const exists = await this.exec(`SELECT datname FROM pg_catalog.pg_database WHERE datname='${creds.database}'`)

      if (exists.rowCount) return
      // REVISIT: cleanup database for local development
      if (!process._send) await this.exec(`DROP DATABASE IF EXISTS "${creds.database}"`)
      await this.exec(`
        DROP GROUP IF EXISTS "${creds.usergroup}";
        DROP USER IF EXISTS "${creds.user}";
        CREATE GROUP "${creds.usergroup}";
        CREATE USER "${creds.user}" WITH CREATEROLE IN GROUP "${creds.usergroup}" PASSWORD '${creds.user}';
        GRANT "${creds.usergroup}" TO "${creds.user}" WITH ADMIN OPTION;
      `)
      await this.exec(`CREATE DATABASE "${creds.database}" OWNER="${creds.user}" TEMPLATE=template0`)
    } catch {
      // Failed to connect to database
      if (!this.dbc) {
        return this.database({ database })
      }
      // Failed to reset database
    } finally {
      // Only clean when successfully connected
      if (this.dbc) {
        await this.dbc.end()
        delete this.dbc

        // Update credentials to new Database owner
        await this.disconnect()
        this.options.credentials = Object.assign({}, system, creds)
      }
    }
  }

  async tenant({ database, tenant }, clean = false) {
    const creds = {
      database: database,
      usergroup: `${database}_USERS`,
      schema: tenant,
      user: `${tenant}_USER`,
    }
    creds.password = creds.user

    try {
      if (!clean) {
        await cds
          .run(`CREATE USER "${creds.user}" IN GROUP "${creds.usergroup}" PASSWORD '${creds.password}'`)
          .catch(e => {
            if (e.code === '42710') return
            throw e
          })
        // Retry granting priviledges as this is being done by multiple instances
        // Postgres just rejects when other connections are granting the same user
        const grant = (i = 0) => cds.run(`GRANT CREATE, CONNECT ON DATABASE "${creds.database}" TO "${creds.user}";`)
          .catch((err) => {
            if (i > 100) throw err
            return grant(i + 1)
          })
        await grant()
      }

      // Update credentials to new Schema owner
      await this.disconnect()
      this.options.credentials = Object.assign({}, this.options.credentials, creds)

      // Create new schema using schema owner
      await this.tx(async tx => {
        await tx.run(`DROP SCHEMA IF EXISTS "${creds.schema}" CASCADE`)
        if (!clean) await tx.run(`CREATE SCHEMA "${creds.schema}" AUTHORIZATION "${creds.user}"`)
      })
    } finally {
      await this.disconnect()
    }
  }
}

class QueryStream extends Query {
  constructor(config, one, objectMode) {
    // REVISIT: currently when setting the row chunk size
    // it results in an inconsistent connection state
    // if (!one) config.rows = 1000
    super(config)

    this._one = one || config.one

    this.stream = new Readable({
      objectMode,
      read: this.rows
        ? () => {
          this.stream.pause()
          // Request more rows
          this.connection.execute({
            portal: this.portal,
            rows: this.rows,
          })
          this.connection.flush()
        }
        : () => { },
    })
    this.push = this.stream.push.bind(this.stream)

    this._prom = new Promise((resolve, reject) => {
      let hasData = false
      this.once('error', reject)
      this.once('end', () => {
        if (!objectMode && !this._one) {
          if (!hasData) this.push(this.constructor.open)
          this.push(this.constructor.close)
        }
        this.push(null)
        if (this.stream.isPaused()) this.stream.resume()
        resolve(this._one ? null : this.stream)
      })
      this.once('row', row => {
        hasData = true
        if (row == null) return resolve(null)
        resolve(this.stream)
      })
    })
  }

  static sep = Buffer.from(',')
  static open = Buffer.from('[')
  static close = Buffer.from(']')

  // Trigger query initialization
  _getRows(connection) {
    this.connection = connection
    connection.execute({
      portal: this.portal,
      rows: this.rows ? 1 : undefined,
    })
    if (this.rows) {
      connection.flush()
    } else {
      connection.sync()
    }
  }

  // Delay requesting more rows until next is called
  handlePortalSuspended() {
    this.stream.resume()
  }

  // Provides metadata information from the database
  handleRowDescription(msg) {
    // Use default parser for binary results
    if (msg.fields.length === 1 && msg.fields[0].dataTypeID === 17) {
      this.handleDataRow = this.handleBinaryRow
    } else {
      this.handleDataRow = msg => {
        const val = msg.fields[0]
        const objectMode = this.stream.readableObjectMode
        if (!objectMode && !this._one && val !== null) this.push(this.constructor.open)
        this.emit('row', val)
        this.push(objectMode ? JSON.parse(val) : val)

        delete this.handleDataRow
        if (objectMode) {
          this.handleDataRow = this.handleDataRowObjectMode
        }
      }
    }
    return super.handleRowDescription(msg)
  }

  // Called when a new row is received
  handleDataRow(msg) {
    this.push(this.constructor.sep)
    this.push(msg.fields[0])
  }

  // Called when a new row is received
  handleDataRowObjectMode(msg) {
    this.push(JSON.parse(msg.fields[0]))
  }

  // Called when a new binary row is received
  handleBinaryRow(msg) {
    const val = msg.fields[0] === null ? null : this._result._parsers[0](msg.fields[0])
    this.push(val)
    this.emit('row', val)
  }

  then(resolve, reject) {
    return this._prom.then(resolve, reject)
  }
}

class ParameterStream extends Writable {
  constructor(queryName, id) {
    super({})
    this.queryName = queryName
    this.id = id
    this.text = `COPY "$$PARAMETER_BUFFER$$"(param,name,id) FROM STDIN DELIMITER ',' QUOTE '${this.constructor.sep}' CSV`
    this.lengthBuffer = Buffer.from([0x64, 0, 0, 0, 0])

    // Flush quote character before input stream
    this.flushChunk = (chunk, cb) => {
      delete this.flushChunk

      this.lengthBuffer.writeUInt32BE(chunk.length + 5, 1)
      this.connection.stream.write(this.lengthBuffer)
      this.connection.stream.write(this.constructor.sep)
      this.connection.stream.write(chunk, cb)
    }
  }

  static sep = Buffer.from(String.fromCharCode(31)) // Separator One
  static done = Buffer.from([0x63, 0, 0, 0, 4])

  then(resolve, reject) {
    this.on('error', reject)
    this.on('finish', resolve)
  }

  /**
   * Indicates that the query was started by the connection
   * @param {Object} connection
   */
  submit(connection) {
    this.connection = connection
    // Initialize query to be executed
    connection.query(this.text)
  }

  // Used by the client to handle timeouts
  callback() { }

  _write(chunk, enc, cb) {
    return this.flush(chunk, cb)
  }

  _construct(cb) {
    this.handleCopyInResponse = () => cb()
  }

  _destroy(err, cb) {
    this.handleError = () => {
      this.callback()
      this.connection = null
      cb(err)
    }
    this.connection.sendCopyFail(err ? err.message : 'ParameterStream early destroy')
  }

  _final(cb) {
    const sep = this.constructor.sep
    this.flush(Buffer.from(`${sep},${this.queryName},${this.id}`), err => {
      if (err) return cb(err)
      this._finish = () => {
        this.emit('finish')
        cb()
      }
      this._destroy = (err, cb) => cb(err)
      this.connection.stream.write(this.constructor.done)
    })
  }

  flush(chunk, cb) {
    this.flushChunk(chunk, cb)
  }

  flushChunk(chunk, cb) {
    this.lengthBuffer.writeUInt32BE(chunk.length + 4, 1)
    this.connection.stream.write(this.lengthBuffer)
    this.connection.stream.write(chunk, cb)
  }

  handleError(e) {
    this.callback()
    this.emit('error', e)
    this.connection = null
  }

  handleCommandComplete(msg) {
    const match = /COPY (\d+)/.exec((msg || {}).text)
    if (match) {
      this.rowCount = parseInt(match[1], 10)
    }
  }

  handleReadyForQuery() {
    this.callback()
    this._finish()
    this.connection = null
  }
}

module.exports = PostgresService
