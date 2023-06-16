const fs = require('fs')
const path = require('path')

const { SQLService } = require('@cap-js/db-service')
const drivers = require('./drivers')
const cds = require('@sap/cds')
const collations = require('./collations.json')

const del = String.fromCharCode(127)

/**
 * @implements SQLService
 */
class HANAService extends SQLService {
  init() {
    // When hdi is enabled it defines the deploy function
    // REVISIT: refactor together with cds-deploy.js
    if (this.options.hdi) {
      super.deploy = this.hdiDeploy
    }

    this.on(['BEGIN'], this.onBEGIN)
    this.on(['COMMIT'], this.onCOMMIT)
    this.on(['ROLLBACK'], this.onROLLBACK)
    return super.init()
  }

  // REVISIT: Add multi tenant factory when clarified
  get factory() {
    return {
      options: { max: 1, ...this.options.pool },
      create: async (/*tenant*/) => {
        const driver = drivers[this.options.driver]?.driver || drivers.default.driver
        const dbc = new driver(this.options.credentials)
        await dbc.connect()
        return dbc
      },
      destroy: dbc => dbc.disconnect(),
      validate: (/*dbc*/) => true,
    }
  }

  // REVISIT: Add multi tenant credential look up when clarified
  url4(tenant) {
    tenant
    let { host, port, driver } = this.options?.credentials || this.options || {}
    return `hana@${host}:${port}${driver ? `(${driver})` : ''}`
  }

  async set(variables) {
    const columns = Object.keys(variables).map(
      k => `SET '${k.replace(/'/g, "''")}'='${(variables[k] + '').replace(/'/g, "''")}';`,
    )
    const sql = `DO BEGIN ${columns.join('')} END;`

    await this.dbc.exec(sql)
  }

  // prepare and exec are both implemented inside the drivers
  prepare(sql) {
    return this.dbc.prepare(sql)
  }

  exec(sql) {
    return this.dbc.exec(sql)
  }

  /**
   * HDI specific deploy logic
   * @param {import('@sap/cds/apis/csn').CSN} model The CSN model to be deployed
   */
  async hdiDeploy(model) {
    const fileGenerator = cds.compile.to.hdbtable(model)
    const sql = fs.promises.readFile(path.resolve(__dirname, 'scripts/deploy.sql'), 'utf-8')
    const hdiconfig = `${await fs.promises.readFile(path.resolve(__dirname, 'scripts/.hdiconfig'), 'utf-8')}`
    let files = [{ path: '.hdiconfig', content: `${hdiconfig}` }]
    for (let [src, { file }] of fileGenerator) {
      files.push({ path: file, content: src })
    }
    const replaces = {
      CONTAINER_GROUP: this.options.credentials.containerGroup,
      CONTAINER_NAME: this.options.credentials.schema,
      JSON_FILES: JSON.stringify(files).replace(/'/g, "''"),
    }

    const fullSQL = `${await sql}`.replace(/{{{([^}]*)}}}/g, (a, b) => replaces[b])
    await this.tx(async tx => tx.run(fullSQL))
    return true
  }

  static CQN2SQL = class CQN2HANA extends SQLService.CQN2SQL {
    SELECT(q) {
      delete this.values

      const { limit, one, orderBy, expand, columns, localized, count } = q.SELECT
      // Ignore one and limit as HANA does not support LIMIT on sub queries
      q.SELECT.one = undefined
      q.SELECT.limit = undefined
      q.SELECT.orderBy = undefined

      // When one of these is defined wrap the query in a sub query
      if (expand || limit || one || orderBy) {
        q.SELECT.expand = false

        // Convert columns to pur references
        const outputColumns = columns.map(c =>
          c === '*'
            ? c
            : {
                ref: [this.column_name(c)],
                elements: c.elements,
                element: c.element,
              },
        )

        if (orderBy) {
          // Ensure that all columns used in the orderBy clause are exposed
          orderBy.forEach(c => {
            if (c.ref?.length === 2) {
              const ref = c.ref + ''
              if (!columns.find(c => c.ref + '' === ref)) {
                const clone = { __proto__: c, ref: c.ref }
                columns.push(clone)
              }
              c.ref = [c.ref[1]]
            }
          })
        }

        if (limit || one || orderBy) {
          // Insert row number column for reducing or sorting the final result
          q = cds.ql
            .SELECT([
              '*',
              {
                xpr: [
                  { func: 'ROW_NUMBER', args: [] },
                  'OVER',
                  {
                    xpr: orderBy ? [` ORDER BY ${this.orderBy(orderBy, localized)}`] : [],
                  },
                ],
                as: '$$RN$$',
              },
            ])
            .from(q)
        }

        // Remove any internal columns added (e.g. orderBy and $$RN$$)
        q = cds.ql.SELECT(outputColumns).from(q)

        if (orderBy) {
          // Replace order by clause with RN as it contains the order by clause already
          q.orderBy([{ ref: ['$$RN$$'] }])
        }

        if (limit || one) {
          // Apply row number limits
          q.where(
            one
              ? [{ ref: ['$$RN$$'] }, '=', { val: 1 }]
              : limit.offset?.val
              ? [
                  { ref: ['$$RN$$'] },
                  '>',
                  limit.offset,
                  'AND',
                  { ref: ['$$RN$$'] },
                  '<=',
                  { val: limit.rows.val + limit.offset.val },
                ]
              : [{ ref: ['$$RN$$'] }, '<=', { val: limit.rows.val }],
          )
        }

        // Pass along SELECT options
        q.SELECT.expand = expand
        q.SELECT._one = one
        q.SELECT.count = count
        // Set new query as root cqn
        if (expand === 'root') this.cqn = q
      }

      super.SELECT(q)

      // Set one and limit back to the query for onSELECT handler
      q.SELECT.one = one
      q.SELECT.limit = limit

      // Currently when combining deep JSON queries there are additional quotes
      // These quotes have to be removed otherwise the JSON is invalid
      // e.g. {"ID":1,"child":"{"ID":2}"} -> {"ID":1,"child":{"ID":2}}
      // When no deep queries are used it will skip this sanitization
      if (q.SELECT.expand === 'root' && this.hasDeep) {
        this.sql = `SELECT REPLACE_REGEXPR('(?:\\\\*")?${del}(?:\\\\*")?|\\\\?(")(.*?)\\\\?(")(?=(?:}|]|,|:)(?:\\S|$))' IN "_json_" WITH '\\1\\2\\3' OCCURRENCE ALL) AS "_json_" FROM  (${this.sql})`
      }

      return this.sql
    }

    SELECT_columns({ SELECT }) {
      if (!SELECT.columns) return '*'
      let sql = SELECT.columns.map(
        SELECT.expand
          ? x => {
              if (x === '*') return '*'
              let xpr = this.column_expr(x)
              if (x.elements || x.element?.elements || x.element?.items) {
                xpr = `'${del}' || ${xpr} || '${del}'`
                this.hasDeep = true
              }
              const converter = x.element?.[this.class._convertOutput] || (e => e)
              return `${converter(xpr)} as "${this.column_name(x).replace(/"/g, '""')}"`
            }
          : x => {
              if (x === '*') return '*'
              let xpr = this.column_expr(x)
              const isStructured = x.element?.elements || x.element?.items
              if (isStructured) {
                xpr = `'${del}' || ${xpr} || '${del}'`
                this.hasDeep = true
              }
              const sql = x.as || isStructured ? `${xpr} as ${this.quote(this.column_name(x))}` : xpr
              return sql
            },
      )
      if (SELECT.expand === 'root') {
        // When using FOR JSON the whole dataset is put into a single blob
        // To increase the potential maximum size of the result set every row is converted to a JSON
        // Making each row a maximum size of 2gb instead of the whole result set to be 2gb
        sql = `(SELECT ${sql} FROM DUMMY FOR JSON ('format'='no', 'omitnull'='no', 'arraywrap'='no')) AS "_json_"`
      }
      return sql
    }

    SELECT_expand({ SELECT }, sql) {
      const { _one, expand } = SELECT
      // To keep the rows separate blobs on root it skips the FOR JSON here
      return expand === 'root'
        ? sql
        : `SELECT coalesce((${sql} FOR JSON ('format'='no', 'omitnull'='no', 'arraywrap'='${
            _one ? 'no' : 'yes'
          }')), '[]') AS "_json_" FROM DUMMY`
    }

    INSERT_entries(q) {
      const { INSERT } = q
      // REVISIT: should @cds.persistence.name be considered ?
      const entity = q.target?.['@cds.persistence.name'] || this.name(q.target?.name || INSERT.into.ref[0])

      const elements = q.elements || q.target?.elements
      if (!elements && !INSERT.entries?.length) {
        return // REVISIT: mtx sends an insert statement without entries and no reference entity
      }
      const columns = elements
        ? ObjectKeys(elements).filter(c => c in elements && !elements[c].virtual && !elements[c].isAssociation)
        : ObjectKeys(INSERT.entries[0])
      this.columns = columns.filter(elements ? c => !elements[c]?.['@cds.extension'] : () => true)

      const extractions = this.managed(
        columns.map(c => ({ name: c })),
        elements,
        !!q.UPSERT,
      )

      // REVISIT: @cds.extension required
      const extraction = extractions.map(c => c.column)
      const converter = extractions.map(c => c.convert)

      this.entries = [[JSON.stringify(INSERT.entries)]]

      return (this.sql = `INSERT INTO ${this.quote(entity)} (${this.columns.map(c =>
        this.quote(c),
      )}) SELECT ${converter} FROM JSON_TABLE(?, '$[*]' COLUMNS(${extraction}))`)
    }

    INSERT_rows(q) {
      const { INSERT } = q
      // REVISIT: should @cds.persistence.name be considered ?
      const entity = q.target?.['@cds.persistence.name'] || this.name(q.target?.name || INSERT.into.ref[0])
      const elements = q.elements || q.target?.elements
      if (!INSERT.columns && !elements) {
        throw cds.error`Cannot insert rows without columns or elements`
      }
      let columns = INSERT.columns || (elements && ObjectKeys(elements))
      if (elements) {
        columns = columns.filter(c => c in elements && !elements[c].virtual && !elements[c].isAssociation)
      }
      this.columns = columns

      const inputConverterKey = this.class._convertInput
      const converter = columns.map((c, i) => {
        const element = elements?.[c] || {}
        const type = this.insertType4(element)
        const extract = `CAST(JSON_VALUE(JSON, '$[${i}]') AS ${type})`
        const converter = element[inputConverterKey] || (e => e)
        return `${converter(extract, element)} AS ${this.quote(c)}`
      })

      // JSON_TABLE([[1],[2],[3]],'$') flattens the nested arrays making it impossible to define the path as '$[n]`
      // even with STRICT path syntax it still flattens the nested arrays
      // Therefor the rows are stringified making q.INSERT.entries the preferred format for inserting
      this.entries = [[JSON.stringify(INSERT.rows.map(r => JSON.stringify(r)))]]

      return (this.sql = `INSERT INTO ${this.quote(entity)} (${this.columns.map(c =>
        this.quote(c),
      )}) SELECT ${converter} FROM JSON_TABLE(?, '$' COLUMNS(JSON NVARCHAR(2147483647) PATH '$'))`)
    }

    UPSERT(q) {
      let { UPSERT } = q,
        sql = this.INSERT({ __proto__: q, INSERT: UPSERT })

      // REVISIT: should @cds.persistence.name be considered ?
      const entity = q.target?.['@cds.persistence.name'] || this.name(q.target?.name || INSERT.into.ref[0])
      const elements = q.elements || q.target?.elements

      const dataSelect = sql.substring(sql.indexOf('SELECT'))

      // Calculate @cds.on.insert
      const collations = this.managed(
        this.columns.map(c => ({ name: c, sql: `NEW.${this.quote(c)}` })),
        elements,
        false,
      )

      let keys = q.target?.keys
      const keyCompare =
        keys &&
        Object.keys(keys)
          .filter(k => !keys[k].isAssociation)
          .map(k => `NEW.${this.quote(k)}=OLD.${this.quote(k)}`)
          .join('AND')

      return (this.sql = `UPSERT ${this.quote(entity)} (${this.columns.map(c =>
        this.quote(c),
      )}) SELECT ${collations.map(keyCompare ? c => c.switch : c => c.sql)} FROM (${dataSelect}) AS NEW ${
        keyCompare ? ` LEFT JOIN ${this.quote(entity)} AS OLD ON ${keyCompare}` : ''
      }`)
    }

    DROP(q) {
      const { target } = q
      const isView = target.query || target.projection
      return (this.sql = `DROP ${isView ? 'VIEW' : 'TABLE'} ${this.name(target.name)}`)
    }

    orderBy(orderBy, localized) {
      return orderBy.map(
        localized
          ? c =>
              this.expr(c) +
              (c.element?.[this.class._localized]
                ? ` COLLATE ${
                    collations[this.context.locale] || collations[this.context.locale.split('_')[0]] || collations['']
                  }`
                : '') +
              (c.sort === 'desc' || c.sort === -1 ? ' DESC' : ' ASC')
          : c => this.expr(c) + (c.sort === 'desc' || c.sort === -1 ? ' DESC' : ' ASC'),
      )
    }

    where(xpr) {
      return this.xpr({ xpr }, ' = TRUE')
    }

    having(xpr) {
      return this.xpr({ xpr }, ' = TRUE')
    }

    xpr({ xpr, _internal }, caseSuffix = '') {
      // Maps the compare operators to what to return when both sides are null
      const compareOperators = {
        '=': true,
        '!=': false,
        // These operators are not allowed in column expressions
        '>': null,
        '<': null,
        '>=': true,
        '<=': true,
        '!<': false,
        '!>': false,
      }

      if (!_internal) {
        for (let i = 0; i < xpr.length; i++) {
          const x = xpr[i]
          if (typeof x === 'string') {
            // HANA does not support comparators in all clauses (e.g. SELECT 1>0 FROM DUMMY)
            // HANA does not have an 'IS' or 'IS NOT' operator
            if (x in compareOperators) {
              const left = xpr[i - 1]
              const right = xpr[i + 1]
              const ifNull = compareOperators[x]

              const compare = {
                xpr: [left, x, right],
                _internal: true,
              }

              const expression = {
                xpr: ['CASE', 'WHEN', compare, 'Then', { val: true }, 'WHEN', 'NOT', compare, 'Then', { val: false }],
                _internal: true,
              }

              if (ifNull != null) {
                // If at least one of the sides is NULL it will go into ELSE
                // This case checks if both sides are NULL and return their result
                expression.xpr.push('ELSE', {
                  xpr: [
                    'CASE',
                    'WHEN',
                    {
                      xpr: [left, 'IS', 'NULL', 'AND', right, 'IS', 'NULL'],
                      _internal: true,
                    },
                    'Then',
                    { val: ifNull },
                    'ELSE',
                    { val: !ifNull },
                    'END',
                  ],
                  _internal: true,
                })
              }
              expression.xpr.push('END')

              xpr[i - 1] = ''
              xpr[i] = expression
              xpr[i + 1] = caseSuffix || ''
            }
          }
        }
      }

      const sql = []
      for (let i = 0; i < xpr.length; ++i) {
        const x = xpr[i]
        if (typeof x === 'string') {
          sql.push(this.operator(x, i, xpr))
        } else if (x.xpr) sql.push(`(${this.xpr(x, caseSuffix)})`)
        // default
        else sql.push(this.expr(x))
      }

      // HANA does not allow WHERE TRUE so when the expression is only a single entry "= TRUE" is appended
      if (caseSuffix && xpr.length === 1) {
        sql.push(caseSuffix)
      }

      return `${sql.join(' ')}`
    }

    operator(x, i, xpr) {
      // Add "= TRUE" before THEN in case statements
      // As all valid comparators are converted to booleans as SQL specifies
      if (x in { THEN: 1, then: 1 }) return ` = TRUE ${x}`
      if ((x in { LIKE: 1, like: 1 } && is_regexp(xpr[i + 1]?.val)) || x === 'regexp') return 'LIKE_REGEXPR'
      else return x
    }

    quote(s) {
      // REVISIT: casing in quotes when reading from entities it uppercase
      // When returning columns from a query they should be case sensitive
      // cds-compiler effectiveName uses toUpperCase for hana dialect, but not for hdbcds
      if (typeof s !== 'string') return '"' + s + '"'
      if (s.includes('"')) return '"' + s.replace(/"/g, '""').toUpperCase() + '"'
      if (s.toUpperCase() in this.class.ReservedWords || /^\d|[$' @./\\]/.test(s)) return '"' + s.toUpperCase() + '"'
      return s
    }

    insertType4(element) {
      // Finds the appropriate data type for JSON_TABLE column definition from cds.type
      if (!element._type) element = cds.builtin.types[element.type] || element
      const fn = element[this.class._insertType]
      return (
        fn?.(element) ||
        element._type?.replace('cds.', '').toUpperCase() ||
        cds.error`Unsupported type: ${element.type}`
      )
    }

    managed(columns, elements, isUpdate = false) {
      const annotation = isUpdate ? '@cds.on.update' : '@cds.on.insert'
      const inputConverterKey = this.class._convertInput
      // Ensure that missing managed columns are added
      const requiredColumns = !elements
        ? []
        : Object.keys(elements)
            .filter(
              e =>
                (elements[e]?.[annotation] || (!isUpdate && elements[e]?.default)) && !columns.find(c => c.name === e),
            )
            .map(name => ({ name, sql: 'NULL' }))

      const keyZero = this.quote(
        ObjectKeys(elements).find(e => {
          const el = elements[e]
          return el.key && !el.isAssociation
        }) || '',
      )

      return [...columns, ...requiredColumns].map(({ name, sql }) => {
        const element = elements?.[name] || {}
        const converter = element[inputConverterKey] || (e => e)
        let managed = element[annotation]?.['=']
        switch (managed) {
          case '$user.id':
          case '$user':
            managed = `SESSION_CONTEXT('$user.id')`
            break
          case '$now':
            managed = `SESSION_CONTEXT('$user.now')`
            break
          default:
            managed = undefined
        }

        const type = this.insertType4(element)
        let extract = sql ?? `${this.quote(name)} ${type} PATH '$.${name}'`
        if (!isUpdate) {
          const d = element.default
          if (d && (d.val !== undefined || d.ref?.[0] === '$now')) {
            const defaultValue = d.val ?? (cds.context?.timestamp || new Date()).toISOString()
            managed = typeof defaultValue === 'string' ? this.string(defaultValue) : defaultValue
          }
        }

        // Switch between OLD and NEW based upon the existence of the column in the NEW dataset
        // Coalesce is not good enough as it would not allow for setting a value to NULL using UPSERT
        const oldOrNew =
          element['@cds.on.update']?.['='] !== undefined
            ? extract
            : `CASE WHEN ${this.quote('$.' + name)} IS NULL THEN OLD.${this.quote(name)} ELSE ${extract} END`

        const notManged = managed === undefined
        return {
          name,
          column: `${extract}, ${this.quote('$.' + name)} NVARCHAR(2147483647) FORMAT JSON PATH '$.${name}'`,
          // For @cds.on.insert ensure that there was no entry yet before setting managed in UPSERT
          switch: notManged
            ? oldOrNew
            : `CASE WHEN OLD.${keyZero} IS NULL THEN COALESCE(${extract},${managed}) ELSE ${oldOrNew} END`,
          convert:
            (notManged
              ? `${converter(this.quote(name), element)} AS ${this.quote(name)}`
              : `CASE WHEN ${this.quote('$.' + name)} IS NULL THEN ${managed} ELSE ${converter(
                  this.quote(name),
                  element,
                )} END AS ${this.quote(name)}`) + (isUpdate ? `,${this.quote('$.' + name)}` : ''),
          sql: converter(notManged ? extract : `COALESCE(${extract}, ${managed})`, element),
        }
      })
    }

    // Loads a static result from the query `SELECT * FROM RESERVED_KEYWORDS`
    static ReservedWords = { ...super.ReservedWords, ...require('./ReservedWords.json') }

    static Functions = require('./cql-functions')

    static TypeMap = {
      ...super.TypeMap,
    }

    // TypeMap used for the JSON_TABLE column definition
    static InsertTypeMap = {
      ...super.TypeMap,
      UUID: () => `NVARCHAR(36)`,
      Boolean: () => `NVARCHAR(5)`,
      LargeString: () => `NVARCHAR(2147483647)`,
      LargeBinary: () => `NVARCHAR(2147483647)`,
      Binary: () => `NVARCHAR(2147483647)`,
      array: () => `NVARCHAR(2147483647)`,
    }

    // HANA JSON_TABLE function does not support BOOLEAN types
    static InputConverters = {
      ...super.InputConverters,
      Binary: e => `BASE64_DECODE(${e})`,
      Boolean: e => `CASE WHEN ${e} = 'true' THEN TRUE WHEN ${e} = 'false' THEN FALSE END`,
    }

    static OutputConverters = {
      ...super.OutputConverters,
      // REVISIT: binaries should use BASE64_ENCODE, but this results in BASE64_ENCODE(BINTONHEX(${e}))
      Binary: e => `BINTONHEX(${e})`,
      Date: e => `to_char(${e}, 'YYYY-MM-DD')`,
      Time: e => `to_char(${e}, 'HH24:MI:SS')`,
      DateTime: e => `to_char(${e}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
      Timestamp: e => `to_char(${e}, 'YYYY-MM-DD"T"HH24:MI:SS.FF7"Z"')`,
    }
  }

  async onSIMPLE({ query, data, event }) {
    const { sql, values } = this.cqn2sql(query, data)
    try {
      let ps = await this.prepare(sql)
      return (await ps.run(values)).changes
    } catch (err) {
      // Allow drop to fail when the view or table does not exist
      if (event === 'DROP ENTITY' && (err.code === 259 || err.code === 321)) {
        return
      }
      throw err
    }
  }

  async dispatch(req) {
    // Look for deployment batch dispatch and execute as single query
    // When deployment is not executed in a batch it will fail to create views
    if (Array.isArray(req.query) && !req.query.find(q => typeof q !== 'string')) {
      req.query = `DO BEGIN ${req.query
        .map(
          q =>
            `EXEC '${q.replace(/'/g, "''").replace(';', '')}${
              // Add "PAGE LOADABLE" for all tables created to use NSE by default and reduce memory consumption
              /(^|')CREATE TABLE/.test(q) ? ' PAGE LOADABLE' : ''
            }';`,
        )
        .join('\n')} END;`
    }
    return super.dispatch(req)
  }

  async onPlainSQL(req, next) {
    // HANA does not support IF EXISTS there for it is removed and the error codes are accepted
    if (/ IF EXISTS /i.test(req.query)) {
      req.query = req.query.replace(/ IF EXISTS/i, '')
      try {
        return await super.onPlainSQL(req, next)
      } catch (err) {
        if (/(^|')DROP /i.test(req.query) && (err.code === 259 || err.code === 321)) {
          return
        }
        throw err
      }
    }

    return super.onPlainSQL(req, next)
  }

  onBEGIN() {}

  onCOMMIT() {
    return this.dbc.commit()
  }

  onROLLBACK() {
    return this.dbc.rollback()
  }

  // Creates a new database using HDI container groups
  async database({ database }, clean = false) {
    if (clean) {
      // Reset back to system credentials
      this.options.credentials = this.options.credentials.sys
    }

    const creds = {
      containerGroup: database.toUpperCase(),
      usergroup: `${database}_USERS`.toUpperCase(),
      user: `${database}_USER_MANAGER`.toUpperCase(),
    }
    creds.schema = creds.user
    creds.password = creds.user + 'Val1d' // Password restrictions require Aa1

    try {
      const con = await this.factory.create(this.options.credentials)
      this.dbc = con

      const drops = [
        `DROP USER ${creds.user} CASCADE;`,
        `CALL _SYS_DI.DROP_CONTAINER_GROUP('${creds.containerGroup}', _SYS_DI.T_NO_PARAMETERS, ?, ?, ?);`,
      ]

      const creas = [
        `CREATE USER ${creds.user} PASSWORD ${creds.password} NO FORCE_FIRST_PASSWORD_CHANGE;`,
        `GRANT USER ADMIN TO ${creds.user};`,
        `CALL _SYS_DI.CREATE_CONTAINER_GROUP('${creds.containerGroup}', _SYS_DI.T_NO_PARAMETERS, ?, ?, ?);`,
        `CREATE LOCAL TEMPORARY COLUMN TABLE #PRIVILEGES LIKE _SYS_DI.TT_API_PRIVILEGES;`,
        `INSERT INTO #PRIVILEGES (PRINCIPAL_NAME, PRIVILEGE_NAME, OBJECT_NAME) SELECT '${creds.user}', PRIVILEGE_NAME, OBJECT_NAME FROM _SYS_DI.T_DEFAULT_CONTAINER_GROUP_ADMIN_PRIVILEGES;`,
        `CALL _SYS_DI.GRANT_CONTAINER_GROUP_API_PRIVILEGES('${creds.containerGroup}', #PRIVILEGES, _SYS_DI.T_NO_PARAMETERS, ?, ?, ?);`,
        `DROP TABLE #PRIVILEGES;`,
      ]

      const queries = clean ? drops : drops.concat(creas)
      const errors = []
      const results = []
      for (let query of queries) {
        results.push(
          await this.exec(query).catch(e => {
            errors.push(e)
          }),
        )
      }
      if (errors.length > 1) {
        throw new Error(`Failed to initialize database:\n${errors.join('\n')}`)
      }
    } finally {
      // Release table lock
      await this.onCOMMIT()

      await this.dbc.disconnect()
      delete this.dbc

      // Update credentials to new Database owner
      await this.disconnect()
      this.options.credentials = Object.assign({}, this.options.credentials, creds, { sys: this.options.credentials })
    }
  }

  // Creates a new HDI container inside the database container group
  // As the tenants are located in a specific container group the containers can have the same name
  // This removes SCHEMA name conflicts when testing in the same system
  // Additionally this allows for deploying using the HDI procedures
  async tenant({ database, tenant }, clean = false) {
    const creds = {
      containerGroup: database.toUpperCase(),
      usergroup: `${database}_USERS`.toUpperCase(),
      schema: tenant.toUpperCase(),
      user: `${tenant}_USER`.toUpperCase(),
    }
    creds.password = creds.user + 'Val1d' // Password restrictions require Aa1

    try {
      const con = await this.factory.create(this.options.credentials)
      this.dbc = con

      const drops = [
        `CREATE LOCAL TEMPORARY COLUMN TABLE #IGNORE LIKE _SYS_DI.TT_PARAMETERS;`,
        `INSERT INTO #IGNORE (KEY, VALUE) values ('IGNORE_DEPLOYED', TRUE);`,
        `INSERT INTO #IGNORE (KEY, VALUE) values ('IGNORE_WORK', TRUE);`,
        `CALL _SYS_DI#${creds.containerGroup}.DROP_CONTAINER('${creds.schema}', #IGNORE, ?, ?, ?);`,
        `DROP USER ${creds.user} CASCADE;`,
      ]

      const creas = [
        `CREATE USER ${creds.user} PASSWORD ${creds.password} NO FORCE_FIRST_PASSWORD_CHANGE;`,
        `CALL _SYS_DI#${creds.containerGroup}.CREATE_CONTAINER('${creds.schema}', _SYS_DI.T_NO_PARAMETERS, ?, ?, ?);`,
        `CALL _SYS_DI#${creds.containerGroup}.CONFIGURE_LIBRARIES('${creds.schema}', _SYS_DI.T_DEFAULT_LIBRARIES, _SYS_DI.T_NO_PARAMETERS, ?,?,?);`,
        `CREATE LOCAL TEMPORARY COLUMN TABLE #PRIVILEGES LIKE _SYS_DI.TT_API_PRIVILEGES;`,
        `INSERT INTO #PRIVILEGES (PRINCIPAL_NAME, PRIVILEGE_NAME, OBJECT_NAME) SELECT '${creds.user}', PRIVILEGE_NAME, OBJECT_NAME FROM _SYS_DI.T_DEFAULT_CONTAINER_ADMIN_PRIVILEGES;`,
        `INSERT INTO #PRIVILEGES (PRINCIPAL_NAME, PRIVILEGE_NAME, OBJECT_NAME) SELECT '${creds.user}', PRIVILEGE_NAME, OBJECT_NAME FROM _SYS_DI.T_DEFAULT_CONTAINER_USER_PRIVILEGES;`,
        `CALL _SYS_DI#${creds.containerGroup}.GRANT_CONTAINER_API_PRIVILEGES('${creds.schema}', #PRIVILEGES, _SYS_DI.T_NO_PARAMETERS, ?, ?, ?);`,
        `DROP TABLE #PRIVILEGES;`,
        `CREATE LOCAL TEMPORARY COLUMN TABLE #PRIVILEGES LIKE _SYS_DI.TT_SCHEMA_PRIVILEGES;`,
        `INSERT INTO #PRIVILEGES ( PRIVILEGE_NAME, PRINCIPAL_SCHEMA_NAME, PRINCIPAL_NAME ) VALUES ( 'SELECT', '', '${creds.user}' );`,
        `INSERT INTO #PRIVILEGES ( PRIVILEGE_NAME, PRINCIPAL_SCHEMA_NAME, PRINCIPAL_NAME ) VALUES ( 'INSERT', '', '${creds.user}' );`,
        `INSERT INTO #PRIVILEGES ( PRIVILEGE_NAME, PRINCIPAL_SCHEMA_NAME, PRINCIPAL_NAME ) VALUES ( 'UPDATE', '', '${creds.user}' );`,
        `INSERT INTO #PRIVILEGES ( PRIVILEGE_NAME, PRINCIPAL_SCHEMA_NAME, PRINCIPAL_NAME ) VALUES ( 'DELETE', '', '${creds.user}' );`,
        `INSERT INTO #PRIVILEGES ( PRIVILEGE_NAME, PRINCIPAL_SCHEMA_NAME, PRINCIPAL_NAME ) VALUES ( 'EXECUTE', '', '${creds.user}' );`,
        `INSERT INTO #PRIVILEGES ( PRIVILEGE_NAME, PRINCIPAL_SCHEMA_NAME, PRINCIPAL_NAME ) VALUES ( 'CREATE TEMPORARY TABLE', '', '${creds.user}' );`,
        `INSERT INTO #PRIVILEGES ( PRIVILEGE_NAME, PRINCIPAL_SCHEMA_NAME, PRINCIPAL_NAME ) VALUES ( 'CREATE ANY', '', '${creds.user}' );`,
        `CALL _SYS_DI#${creds.containerGroup}.GRANT_CONTAINER_SCHEMA_PRIVILEGES('${creds.schema}', #PRIVILEGES, _SYS_DI.T_NO_PARAMETERS, ?, ?, ?);`,
        `DROP TABLE #PRIVILEGES;`,
      ]

      const queries = clean ? drops : drops.concat(creas)
      const errors = []
      const results = []
      for (let query of queries) {
        results.push(
          await this.exec(query).catch(e => {
            errors.push(e)
          }),
        )
      }
      if (errors.length > 2) {
        throw new Error(`Failed to initialize tenant:\n${errors.join('\n')}`)
      }
    } finally {
      await this.dbc.disconnect()
      delete this.dbc
    }
    // Update credentials to new Tenant owner
    await this.disconnect()
    this.options.credentials = Object.assign({}, this.options.credentials, creds)
  }
}

Buffer.prototype.toJSON = function () {
  return this.toString('base64')
}

const is_regexp = x => x?.constructor?.name === 'RegExp' // NOTE: x instanceof RegExp doesn't work in repl
const ObjectKeys = o => (o && [...ObjectKeys(o.__proto__), ...Object.keys(o)]) || []

module.exports = HANAService
