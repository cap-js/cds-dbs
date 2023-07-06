const { SQLService } = require('@cap-js/db-service')
const { Client } = require('pg')
const cds = require('@sap/cds/lib')
const crypto = require('crypto')

class PostgresService extends SQLService {
  init() {
    if (!this.options.independentDeploy) {
      // REVISIT: injects dialect into cds.deploy logic
      cds.options = cds.options || {}
      cds.options.dialect = 'postgres'
    }
    this.kind = 'postgres'
    return super.init(...arguments)
  }

  get factory() {
    return {
      options: {
        min: 0,
        testOnBorrow: true,
        acquireTimeoutMillis: 1000,
        destroyTimeoutMillis: 1000,
        ...this.options.pool
      },
      create: async () => {
        const cr = this.options.credentials || {}
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
          ssl: cr.sslrootcert && {
            rejectUnauthorized: false,
            ca: cr.sslrootcert,
          },
        }
        const dbc = new Client(credentials)
        await dbc.connect()
        return dbc
      },
      destroy: dbc => dbc.end(),
      validate: dbc => dbc.open,
    }
  }

  url4() {
    // TODO: Maybe log which database and which user? Be more robust against missing properties?
    let { host, port } = this.options?.credentials || this.options || {}
    return host + ':' + (port || 5432)
  }

  async set(variables) {
    // REVISIT: remove when all environment variables are aligned
    // RESTRICTIONS: 'Custom parameter names must be two or more simple identifiers separated by dots.'
    const nameMap = {
      '$user.id': 'CAP.APPLICATIONUSER',
      '$user.locale': 'CAP.LOCALE',
      '$valid.from': 'CAP.VALID_FROM',
      '$valid.to': 'CAP.VALID_TO',
    }

    const env = {}
    for (let name in variables) {
      env[nameMap[name]] = variables[name]
    }

    return Promise.all([
      (await this.prepare(`SELECT set_config(key::text,$1->>key,false) FROM json_each($1);`)).run([
        JSON.stringify(env),
      ]),
      ...(this.options?.credentials?.schema
        ? [this.exec(`SET search_path TO "${this.options?.credentials?.schema}";`)]
        : []),

      ...(!this._initalCollateCheck
        ? [
            (await this.prepare(`SELECT collname FROM pg_collation WHERE collname = 'en_US' OR collname ='en-x-icu';`))
              .all([])
              .then(resp => {
                this._initalCollateCheck = true
                if (resp.find(row => row.collname === 'en_US')) return
                if (resp.find(row => row.collname === 'en-x-icu'))
                  this.class.CQN2SQL.prototype.orderBy = this.class.CQN2SQL.prototype.orderByICU
                // REVISIT throw error when there is no collated libary found
              }),
          ]
        : []),
    ])
  }

  prepare(sql) {
    const query = {
      text: sql,
      // Track queries name for postgres referencing prepare statements
      // sha1 as it needs to be less then 63 characters
      name: crypto.createHash('sha1').update(sql).digest('hex'),
    }
    return {
      run: async values => {
        // REVISIT: SQLService provides empty values as {} for plain SQL statements - PostgreSQL driver expects array or nothing - see issue #78
        const result = await this.dbc.query({ ...query, values: this._getValues(values) })
        return { changes: result.rowCount }
      },
      get: async values => {
        // REVISIT: SQLService provides empty values as {} for plain SQL statements - PostgreSQL driver expects array or nothing - see issue #78
        const result = await this.dbc.query({ ...query, values: this._getValues(values) })
        return result.rows[0]
      },
      all: async values => {
        // REVISIT: SQLService provides empty values as {} for plain SQL statements - PostgreSQL driver expects array or nothing - see issue #78
        try {
          const result = await this.dbc.query({ ...query, values: this._getValues(values) })
          return result.rows
        } catch (e) {
          throw Object.assign(e, { sql: sql + '\n' + new Array(e.position).fill(' ').join('') + '^' })
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

  async exec(sql) {
    return this.dbc.query(sql)
  }

  onPlainSQL(req, next) {
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
    // Look for ? placeholders outside of string and replace them with $n
    if (/('|")(\1|[^\1]*?\1)|(\?)/.exec(query)?.[3]) {
      let i = 1
      // eslint-disable-next-line no-unused-vars
      req.query = query.replace(/('|")(\1|[^\1]*?\1)|(\?)/g, (a, _b, _c, d, _e, _f, _g) => (d ? '$' + i++ : a))
    }

    return super.onPlainSQL(req, next)
  }

  static CQN2SQL = class CQN2Postgres extends SQLService.CQN2SQL {
    orderBy(orderBy, localized) {
      return orderBy.map(
        localized
          ? c =>
              this.expr(c) +
              (c.element?.[this.class._localized] ? ` COLLATE "${this.context.locale}"` : '') +
              (c.sort === 'desc' || c.sort === -1 ? ' DESC' : ' ASC')
          : c => this.expr(c) + (c.sort === 'desc' || c.sort === -1 ? ' DESC' : ' ASC'),
      )
    }

    orderByICU(orderBy, localized) {
      return orderBy.map(
        localized
          ? c =>
              this.expr(c) +
              (c.element?.[this.class._localized] ? ` COLLATE "${this.context.locale.replace('_', '-')}-x-icu"` : '') +
              (c.sort === 'desc' || c.sort === -1 ? ' DESC' : ' ASC')
          : c => this.expr(c) + (c.sort === 'desc' || c.sort === -1 ? ' DESC' : ' ASC'),
      )
    }

    from(from) {
      if (from.ref?.[0] === 'sqlite.schema') {
        return '(SELECT table_name as name from information_schema.tables where table_schema = current_schema()) as schema'
      }
      // REVISIT: postgres always needs an alias for sub selects
      if (from.SELECT && !from.as) from.as = from.SELECT.as || 'unknown'
      return super.from(from)
    }

    // REVISIT: pg requires alias for {val}
    SELECT_columns({ SELECT }) {
      // REVISIT: Genres cqn has duplicate ID column
      if (!SELECT.columns) return '*'
      const unique = {}
      return SELECT.columns
        .map(x => `${this.column_expr(x)} as ${this.quote(this.column_name(x))}`)
        .filter(x => {
          if (unique[x]) return false
          unique[x] = true
          return true
        })
    }

    SELECT_expand({ SELECT }, sql) {
      if (!SELECT.columns) return sql
      const queryAlias = this.quote(SELECT.from?.as || (SELECT.expand === 'root' && 'root'))
      const cols = SELECT.columns.map(x => {
        const name = this.column_name(x)
        let col = `${this.string(name)},${this.output_converter4(x.element, queryAlias + '.' + this.quote(name))}`

        if (x.SELECT?.count) {
          // Return both the sub select and the count for @odata.count
          const qc = cds.ql.clone(x, { columns: [{ func: 'count' }], one: 1, limit: 0, orderBy: 0 })
          col += `, '${name}@odata.count',${this.expr(qc)}`
        }
        return col
      })
      let obj = `json_build_object(${cols})`
      return `SELECT ${
        SELECT.one || SELECT.expand === 'root' ? obj : `coalesce(json_agg(${obj}),'[]'::json)`
      } as _json_ FROM (${sql}) as ${queryAlias}`
    }

    INSERT(q, isUpsert = false) {
      super.INSERT(q, isUpsert)

      // REVISIT: this should probably be made a bit easier to adopt
      return (this.sql = this.sql
        // Adjusts json path expressions to be postgres specific
        .replace(/->>'\$(?:(?:\."(.*?)")|(?:\[(\d*)\]))'/g, (a, b, c) => (b ? `->>'${b}'` : `->>${c}`))
        // Adjusts json function to be postgres specific
        .replace('json_each(?)', 'json_array_elements($1)')
        .replace(/json_type\((\w+),'\$\."(\w+)"'\)/g, (_a, b, c) => `json_typeof(${b}->'${c}')`))
    }

    val(val) {
      const ret = super.val(val)
      return ret === '?' ? `$${this.values.length}` : ret
    }

    operator(x) {
      if (x === 'regexp') return '~'
      if (x === '=') return 'is not distinct from'
      if (x === '!=') return 'is distinct from'
      else return x
    }

    defaultValue(defaultValue = this.context.timestamp.toISOString()) {
      return this.string(`${defaultValue}`)
    }

    static Functions = { ...super.Functions, ...require('./func') }

    static ReservedWords = { ...super.ReservedWords, ...require('./ReservedWords.json') }

    static TypeMap = {
      ...super.TypeMap,
      // REVISIT: check whether we should use native UUID support
      UUID: () => `VARCHAR(36)`,
      String: e => `VARCHAR(${e.length || 5000})`,
      Binary: () => `BYTEA`,
      Double: () => 'FLOAT8',
      LargeString: () => 'TEXT',
      LargeBinary: () => 'BYTEA',
      array: () => 'TEXT',
      Time: () => 'TIME',
      DateTime: () => 'TIMESTAMP',
      Timestamp: () => 'TIMESTAMP',
    }

    // Used for INSERT statements
    static InputConverters = {
      ...super.InputConverters,
      // UUID:      (e) => `CAST(${e} as UUID)`, // UUID is strict in formatting sflight does not comply
      boolean: e => `CASE ${e} WHEN 'true' THEN true WHEN 'false' THEN false END`,
      Float: (e, t) => `CAST(${e} as decimal${t.precision && t.scale ? `(${t.precision},${t.scale})` : ''})`,
      Decimal: (e, t) => `CAST(${e} as decimal${t.precision && t.scale ? `(${t.precision},${t.scale})` : ''})`,
      Integer: e => `CAST(${e} as integer)`,
      Int64: e => `CAST(${e} as bigint)`,
      Date: e => `CAST(${e} as DATE)`,
      Time: e => `CAST(${e} as TIME)`,
      DateTime: e => `CAST(${e} as TIMESTAMP)`,
      Timestamp: e => `CAST(${e} as TIMESTAMP)`,
      // REVISIT: Remove that with upcomming fixes in cds.linked
      Double: (e, t) => `CAST(${e} as decimal${t.precision && t.scale ? `(${t.precision},${t.scale})` : ''})`,
      DecimalFloat: (e, t) => `CAST(${e} as decimal${t.precision && t.scale ? `(${t.precision},${t.scale})` : ''})`,
      Binary: e => `CAST(${e} as bytea)`,
      LargeBinary: e => `CAST(${e} as bytea)`,
    }

    static OutputConverters = {
      ...super.OutputConverters,
      Binary: e => e,
      LargeBinary: e => e,
      Date: e => `to_char(${e}, 'YYYY-MM-DD')`,
      Time: e => `to_char(${e}, 'HH24:MI:SS')`,
      DateTime: e => `to_char(${e}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
      Timestamp: e => `to_char(${e}, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')`,
      UTCDateTime: e => `to_char(${e}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
      UTCTimestamp: e => `to_char(${e}, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')`,
      struct: e => `json(${e})`,
      array: e => `json(${e})`,
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
      `)
      await this.exec(`CREATE DATABASE "${creds.database}" OWNER="${creds.user}" TEMPLATE=template0`)
    } catch (e) {
      // Failed to reset database
    } finally {
      await this.dbc.end()
      delete this.dbc

      // Update credentials to new Database owner
      await this.disconnect()
      this.options.credentials = Object.assign({}, system, creds)
    }
  }

  async tenant({ database, tenant }) {
    const creds = {
      database: database,
      usergroup: `${database}_USERS`,
      schema: tenant,
      user: `${tenant}_USER`,
    }
    creds.password = creds.user

    try {
      await this.tx(async tx => {
        // await tx.run(`DROP USER IF EXISTS "${creds.user}"`)
        await tx
          .run(`CREATE USER "${creds.user}" IN GROUP "${creds.usergroup}" PASSWORD '${creds.password}'`)
          .catch(e => {
            if (e.code === '42710') return
            throw e
          })
      })
      await this.tx(async tx => {
        await tx.run(`GRANT CREATE, CONNECT ON DATABASE "${creds.database}" TO "${creds.user}";`)
      })

      // Update credentials to new Schema owner
      await this.disconnect()
      this.options.credentials = Object.assign({}, this.options.credentials, creds)

      // Create new schema using schema owner
      await this.tx(async tx => {
        await tx.run(`DROP SCHEMA IF EXISTS "${creds.schema}" CASCADE`)
        await tx.run(`CREATE SCHEMA "${creds.schema}" AUTHORIZATION "${creds.user}"`).catch(() => {})
      })
    } finally {
      await this.disconnect()
    }
  }
}

module.exports = PostgresService
