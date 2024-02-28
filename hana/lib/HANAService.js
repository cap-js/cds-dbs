const fs = require('fs')
const path = require('path')
const { Readable } = require('stream')

const { SQLService } = require('@cap-js/db-service')
const drivers = require('./drivers')
const cds = require('@sap/cds')
const collations = require('./collations.json')

const DEBUG = cds.debug('sql|db')
let HANAVERSION = 0

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
    const driver = drivers[this.options.driver || this.options.credentials?.driver]?.driver || drivers.default.driver
    const isMultitenant = 'multiTenant' in this.options ? this.options.multiTenant : cds.env.requires.multitenancy
    const service = this
    return {
      options: {
        min: 0,
        max: 10,
        acquireTimeoutMillis: cds.env.profiles.includes('production') ? 1000 : 10000,
        idleTimeoutMillis: 60000,
        evictionRunIntervalMillis: 100000,
        numTestsPerEvictionRun: Math.ceil((this.options.pool?.max || 10) - (this.options.pool?.min || 0) / 3),
        ...(this.options.pool || {}),
        testOnBorrow: true,
        fifo: false
      },
      create: async function (tenant) {
        try {
          const { credentials } = isMultitenant
            ? await require('@sap/cds-mtxs/lib').xt.serviceManager.get(tenant, { disableCache: false })
            : service.options
          const dbc = new driver(credentials)
          await dbc.connect()
          HANAVERSION = dbc.server.major
          return dbc
        } catch (err) {
          if (!isMultitenant || err.code !== 10) throw err
          await require('@sap/cds-mtxs/lib').xt.serviceManager.get(tenant, { disableCache: true })
          return this.create(tenant)
        }
      },
      error: (err /*, tenant*/) => {
        // Check whether the connection error was an authentication error
        if (err.code === 10) {
          // REVISIT: Refresh the credentials when possible
          cds.exit(1)
        }
        // REVISIT: Add additional connection error scenarios
        try {
          cds.error(err)
        } finally {
          cds.exit(1)
        }
      },
      destroy: dbc => dbc.disconnect(),
      validate: (dbc) => dbc.validate(),
    }
  }

  // REVISIT: Add multi tenant credential look up when clarified
  url4(tenant) {
    tenant
    let { host, port, driver } = this.options?.credentials || this.options || {}
    return `hana@${host}:${port}${driver ? `(${driver})` : ''}`
  }

  ensureDBC() {
    return this.dbc || cds.error`Database is disconnected`
  }

  async set(variables) {
    // REVISIT: required to be compatible with generated views
    if (variables['$valid.from']) variables['VALID-FROM'] = variables['$valid.from']
    if (variables['$valid.to']) variables['VALID-TO'] = variables['$valid.to']
    if (variables['$user.id']) variables['APPLICATIONUSER'] = variables['$user.id']
    if (variables['$user.locale']) variables['LOCALE'] = variables['$user.locale']

    this.ensureDBC().set(variables)
  }

  async onSELECT(req) {
    const { query, data } = req
    if (!query.target) {
      try { this.infer(query) } catch (e) { /**/ }
    }
    if (!query.target || query.target._unresolved) {
      return super.onSELECT(req)
    }

    // REVISIT: disable this for queries like (SELECT 1)
    // Will return multiple rows with objects inside
    query.SELECT.expand = 'root'
    const { cqn, temporary, blobs, withclause, values } = this.cqn2sql(query, data)
    // REVISIT: add prepare options when param:true is used
    const sqlScript = this.wrapTemporary(temporary, withclause, blobs)
    let rows = (values?.length || blobs.length > 0)
      ? await (await this.prepare(sqlScript, blobs.length)).all(values || [])
      : await this.exec(sqlScript)
    if (rows.length) {
      rows = this.parseRows(rows)
    }
    if (cqn.SELECT.count) {
      // REVISIT: the runtime always expects that the count is preserved with .map, required for renaming in mocks
      return HANAService._arrayWithCount(rows, await this.count(query, rows))
    }
    return cqn.SELECT.one || query.SELECT.from.ref?.[0].cardinality?.max === 1 ? rows[0] || null : rows
  }

  async onINSERT({ query, data }) {
    try {
      const { sql, entries, cqn } = this.cqn2sql(query, data)
      if (!sql) return // Do nothing when there is nothing to be done
      const ps = await this.prepare(sql)
      // HANA driver supports batch execution
      const results = await (entries
        ? HANAVERSION <= 2
          ? entries.reduce((l, c) => l.then(() => ps.run(c)), Promise.resolve(0))
          : ps.run(entries[0])
        : ps.run())
      return new this.class.InsertResults(cqn, results)
    } catch (err) {
      throw _not_unique(err, 'ENTITY_ALREADY_EXISTS')
    }
  }

  async onUPDATE(req) {
    try {
      return await super.onUPDATE(req)
    } catch (err) {
      throw _not_unique(err, 'UNIQUE_CONSTRAINT_VIOLATION') || err
    }
  }

  // Allow for running complex expand queries in a single statement
  wrapTemporary(temporary, withclauses, blobs) {
    const blobColumn = b => `"${b.replace(/"/g, '""')}"`

    const values = temporary
      .map(t => {
        const blobColumns = blobs.map(b => (b in t.blobs) ? blobColumn(b) : `NULL AS ${blobColumn(b)}`)
        return `SELECT "_path_","_blobs_","_expands_","_json_"${blobColumns.length ? ',' : ''}${blobColumns} FROM (${t.select})`
      })

    const withclause = withclauses.length ? `WITH ${withclauses} ` : ''
    const ret = withclause + (values.length === 1 ? values[0] : 'SELECT * FROM ' + values.map(v => `(${v})`).join(' UNION ALL ') + ' ORDER BY "_path_" ASC')
    DEBUG?.(ret)
    return ret
  }

  // Structure flat rows into expands and include raw blobs as raw buffers
  parseRows(rows) {
    const ret = []
    const levels = [
      {
        data: ret,
        path: '$[',
        expands: {},
      },
    ]

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const expands = JSON.parse(row._expands_)
      const blobs = JSON.parse(row._blobs_)
      const data = Object.assign(JSON.parse(row._json_), expands, blobs)
      Object.keys(blobs).forEach(k => (data[k] = this._stream(row[k] || data[k])))

      // REVISIT: try to unify with handleLevel from base driver used for streaming
      while (levels.length) {
        const level = levels[levels.length - 1]
        // Check if the current row is a child of the current level
        if (row._path_.indexOf(level.path) === 0) {
          // Check if the current row is an expand of the current level
          const property = row._path_.slice(level.path.length + 2, -7)
          if (property in level.expands) {
            if (level.expands[property]) {
              level.data[property].push(data)
            } else {
              level.data[property] = data
            }
            levels.push({
              data: data,
              path: row._path_,
              expands,
            })
            break
          } else {
            // REVISIT: identify why sometimes not all parent rows are returned
            level.data.push?.(data)
            levels.push({
              data: data,
              path: row._path_,
              expands,
            })
            break
          }
        } else {
          // Step up if it is not a child of the current level
          levels.pop()
        }
      }
    }
    return ret
  }

  // prepare and exec are both implemented inside the drivers
  prepare(sql, hasBlobs) {
    return this.ensureDBC().prepare(sql, hasBlobs)
  }

  exec(sql) {
    return this.ensureDBC().exec(sql)
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

    static _init() {
      this._insertType = this._add_mixins(':insertType', this.InsertTypeMap)
      return super._init()
    }

    SELECT(q) {
      // Collect all queries and blob columns of all queries
      this.blobs = this.blobs || []
      this.withclause = this.withclause || []
      this.temporary = this.temporary || []
      this.temporaryValues = this.temporaryValues || []

      const { limit, one, orderBy, expand, columns = ['*'], localized, count, parent } = q.SELECT

      const walkAlias = q => {
        if (q.args) return q.as || walkAlias(q.args[0])
        if (q.SELECT?.from) return walkAlias(q.SELECT?.from)
        return q.as
      }
      q.as = walkAlias(q)
      const alias = q.alias = `${parent ? parent.alias + '.' : ''}${q.as}`
      const src = q

      // When one of these is defined wrap the query in a sub query
      if (expand || (parent && (limit || one || orderBy))) {
        const { element, elements } = q

        q = cds.ql.clone(q)
        if (parent) {
          q.SELECT.limit = undefined
          q.SELECT.one = undefined
          q.SELECT.orderBy = undefined
        }
        q.SELECT.expand = false

        const outputColumns = [...columns.filter(c => c.as !== '_path_')]

        if (parent) {
          // Track parent _path_ for later concatination
          if (!columns.find(c => this.column_name(c) === '_path_'))
            columns.push({ ref: [parent.as, '_path_'], as: '_parent_path_' })
        }

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

        // Insert row number column for reducing or sorting the final result
        const over = { xpr: [] }
        // TODO: replace with full path partitioning
        if (parent) over.xpr.push(`PARTITION BY ${this.ref({ ref: ['_parent_path_'] })}`)
        if (orderBy?.length) over.xpr.push(` ORDER BY ${this.orderBy(orderBy, localized)}`)
        const rn = { xpr: [{ func: 'ROW_NUMBER', args: [] }, 'OVER', over], as: '$$RN$$' }
        q.as = q.SELECT.from.as

        q = cds.ql.SELECT(['*', rn]).from(q)
        q.as = q.SELECT.from.as

        q = cds.ql.SELECT(outputColumns.map(c => (c.elements ? c : { __proto__: c, ref: [this.column_name(c)] }))).from(q)
        q.as = q.SELECT.from.as
        Object.defineProperty(q, 'elements', { value: elements })
        Object.defineProperty(q, 'element', { value: element })

        if (!q.SELECT.columns.find(c => c.as === '_path_')) {
          q.SELECT.columns.push({
            xpr: [
              {
                func: 'concat',
                args: parent
                  ? [
                    {
                      func: 'concat',
                      args: [{ ref: ['_parent_path_'] }, { val: `].${q.element.name}[`, param: false }],
                    },
                    { func: 'lpad', args: [{ ref: ['$$RN$$'] }, { val: 6, param: false }, { val: '0', param: false }] },
                  ]
                  : [{ val: '$[', param: false }, { func: 'lpad', args: [{ ref: ['$$RN$$'] }, { val: 6, param: false }, { val: '0', param: false }] }],
              },
            ],
            as: '_path_',
          })
        }

        if (parent && (limit || one)) {
          // Apply row number limits
          q.where(
            one
              ? [{ ref: ['$$RN$$'] }, '=', { val: 1, param: false }]
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
        q.src = src
      }

      super.SELECT(q)

      // Set one and limit back to the query for onSELECT handler
      q.SELECT.one = one
      q.SELECT.limit = limit

      if (expand === 'root') {
        this.cqn = q
        const fromSQL = this.from({ ref: [alias] })
        this.withclause.unshift(`${fromSQL} as (${this.sql})`)
        this.temporary.unshift({ blobs: this._blobs, select: `SELECT ${this._outputColumns} FROM ${fromSQL}` })
        if (this.values) {
          this.temporaryValues.unshift(this.values)
          this.values = this.temporaryValues.flat()
        }
      }

      return this.sql
    }

    SELECT_columns(q) {
      const { SELECT, src } = q
      if (!SELECT.columns) return '*'
      const structures = []
      let expands = {}
      let blobs = {}
      let path = `'$['`
      let sql = SELECT.columns
        .map(
          SELECT.expand === 'root'
            ? x => {
              if (x === '*') return '*'
              // means x is a sub select expand
              if (x.elements) {
                expands[this.column_name(x)] = x.SELECT.one ? null : []

                const parent = src
                let fkeys = x.element._foreignKeys
                if (typeof fkeys === 'function') fkeys = fkeys.call(x.element)
                fkeys.forEach(k => {
                  if (!parent.SELECT.columns.find(c => this.column_name(c) === k.parentElement.name)) {
                    parent.SELECT.columns.push({ ref: [parent.as, k.parentElement.name] })
                  }
                })

                x.SELECT.from = {
                  join: 'inner',
                  args: [{ ref: [parent.alias], as: parent.as }, x.SELECT.from],
                  on: x.SELECT.where,
                  as: x.SELECT.from.as,
                }
                x.SELECT.where = undefined
                x.SELECT.expand = 'root'
                x.SELECT.parent = parent

                const values = this.values
                this.values = []
                parent.SELECT.expand = true
                this.SELECT(x)
                this.values = values
                return false
              }
              if (x.element?.type?.indexOf('Binary') > -1) {
                blobs[this.column_name(x)] = null
                return false
              }
              if (x.element?.elements || x.element?.items) {
                // support for structured types and arrays
                structures.push(x)
                return false
              }
              let xpr = this.expr(x)
              const columnName = this.column_name(x)
              if (columnName === '_path_') {
                path = xpr
                return false
              }
              const converter = x.element?.[this.class._convertOutput] || (e => e)
              return `${converter(this.quote(columnName))} as "${columnName.replace(/"/g, '""')}"`
            }
            : x => {
              if (x === '*') return '*'
              // means x is a sub select expand
              if (x.elements) return false
              return this.column_expr(x)
            },
        )
        .filter(a => a)

      if (SELECT.expand === 'root') {
        this._blobs = blobs
        const blobColumns = Object.keys(blobs)
        this.blobs.push(...blobColumns.filter(b => !this.blobs.includes(b)))
        expands = this.string(JSON.stringify(expands))
        blobs = this.string(JSON.stringify(blobs))
        // When using FOR JSON the whole dataset is put into a single blob
        // To increase the potential maximum size of the result set every row is converted to a JSON
        // Making each row a maximum size of 2gb instead of the whole result set to be 2gb
        // Excluding binary columns as they are not supported by FOR JSON and themselves can be 2gb
        const rawJsonColumn = sql.length
          ? `(SELECT ${sql} FROM DUMMY FOR JSON ('format'='no', 'omitnull'='no', 'arraywrap'='no') RETURNS NVARCHAR(2147483647)) AS "_json_"`
          : `TO_NCLOB('{}') AS "_json_"`

        let jsonColumn = rawJsonColumn
        if (structures.length) {
          // Appending the structured columns to prevent them from being quoted and escaped
          // In case of the deep JSON select queries the deep columns depended on a REGEXP_REPLACE which will probably be slower
          const structuresConcat = structures
            .map(x => {
              const name = this.column_name(x)
              return `',"${name}":' || COALESCE(${this.quote(name)},'null')`
            })
            .join(' || ')
          jsonColumn = sql.length
            ? `SUBSTRING("_json_", 1, LENGTH("_json_") - 1) || ${structuresConcat} || '}' as "_json_"`
            : `'{' || '${structuresConcat.substring(2)} || '}' as "_json_"`
        }

        // Calculate final output columns once
        let outputColumns = ''
        outputColumns = `_path_ as "_path_",${blobs} as "_blobs_",${expands} as "_expands_",${jsonColumn}`
        if (blobColumns.length)
          outputColumns = `${outputColumns},${blobColumns.map(b => `${this.quote(b)} as "${b.replace(/"/g, '""')}"`)}`
        this._outputColumns = outputColumns
        sql = `*,${path} as _path_,${rawJsonColumn}`
      }
      return sql
    }

    SELECT_expand(_, sql) {
      return sql
    }

    extractForeignKeys(xpr, alias, foreignKeys = []) {
      // REVISIT: this is a quick method of extracting the foreign keys it could be nicer
      // Find all foreign keys used in the expression so they can be exposed to the follow up expand queries
      JSON.stringify(xpr, (key, val) => {
        if (key === 'ref' && val.length === 2 && val[0] === alias && !foreignKeys.find(k => k.ref + '' === val + '')) {
          foreignKeys.push({ ref: val })
          return
        }
        return val
      })
      return foreignKeys
    }

    // REVISIT: Find a way to avoid overriding the whole function redundantly
    INSERT_entries(q) {
      this.values = undefined
      const { INSERT } = q
      // REVISIT: should @cds.persistence.name be considered ?
      const entity = q.target?.['@cds.persistence.name'] || this.name(q.target?.name || INSERT.into.ref[0])

      const elements = q.elements || q.target?.elements
      if (!elements) {
        return super.INSERT_entries(q)
      }

      const columns = elements
        ? ObjectKeys(elements).filter(c => c in elements && !elements[c].virtual && !elements[c].value && !elements[c].isAssociation)
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

      // HANA Express does not process large JSON documents
      // The limit is somewhere between 64KB and 128KB
      if (HANAVERSION <= 2) {
        this.entries = INSERT.entries.map(e => (e instanceof Readable
          ? [e]
          : [Readable.from(this.INSERT_entries_stream([e], 'hex'), { objectMode: false })]))
      } else {
        this.entries = [[
          INSERT.entries[0] instanceof Readable
            ? INSERT.entries[0]
            : Readable.from(this.INSERT_entries_stream(INSERT.entries, 'hex'), { objectMode: false })
        ]]
      }

      // WITH SRC is used to force HANA to interpret the ? as a NCLOB allowing for streaming of the data
      // Additionally for drivers that did allow for streaming of NVARCHAR they quickly reached size limits
      // This should allow for 2GB of data to be inserted
      // When using a buffer table it would be possible to stream indefinitely
      // For the buffer table to work the data has to be sanitized by a complex regular expression
      // Which in testing took up about a third of the total time processing time
      // With the buffer table approach is also greatly reduces the required memory
      // JSON_TABLE parses the whole JSON document at once meaning that the whole JSON document has to be in memory
      // With the buffer table approach the data is processed in chunks of a configurable size
      // Which allows even smaller HANA systems to process large datasets
      // But the chunk size determines the maximum size of a single row
      return (this.sql = `INSERT INTO ${this.quote(entity)} (${this.columns.map(c =>
        this.quote(c),
      )}) WITH SRC AS (SELECT ? AS JSON FROM DUMMY UNION ALL SELECT TO_NCLOB(NULL) AS JSON FROM DUMMY)
      SELECT ${converter} FROM JSON_TABLE(SRC.JSON, '$' COLUMNS(${extraction}))`)
    }

    INSERT_rows(q) {
      const { INSERT } = q

      // Convert the rows into entries to simplify inserting
      // Tested:
      // - Array JSON INSERT (1.5x)
      // - Simple INSERT with reuse onINSERT (2x)
      // - Simple INSERT with batch onINSERT (1x)
      // - Object JSON INSERT (1x)
      // The problem with Simple INSERT is the type mismatch from csv files
      // Recommendation is to always use entries
      const elements = q.elements || q.target?.elements
      if (!elements) {
        return super.INSERT_rows(q)
      }

      const columns = INSERT.columns || (elements && ObjectKeys(elements))
      const entries = new Array(INSERT.rows.length)
      const rows = INSERT.rows
      for (let x = 0; x < rows.length; x++) {
        const row = rows[x]
        const entry = {}
        for (let y = 0; y < columns.length; y++) {
          entry[columns[y]] = row[y]
        }
        entries[x] = entry
      }
      INSERT.entries = entries
      return this.INSERT_entries(q)
    }

    UPSERT(q) {
      const { UPSERT } = q
      const sql = this.INSERT({ __proto__: q, INSERT: UPSERT })

      // If no definition is available fallback to INSERT statement
      const elements = q.elements || q.target?.elements
      if (!elements) {
        return (this.sql = sql)
      }

      // REVISIT: should @cds.persistence.name be considered ?
      const entity = q.target?.['@cds.persistence.name'] || this.name(q.target?.name || INSERT.into.ref[0])
      const dataSelect = sql.substring(sql.indexOf('WITH'))

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
          .filter(k => !keys[k].isAssociation && !keys[k].virtual)
          .map(k => `NEW.${this.quote(k)}=OLD.${this.quote(k)}`)
          .join(' AND ')

      return (this.sql = `UPSERT ${this.quote(entity)} (${this.columns.map(c =>
        this.quote(c),
      )}) SELECT ${collations.map(keyCompare ? c => c.switch : c => c.sql)} FROM (${dataSelect}) AS NEW ${keyCompare ? ` LEFT JOIN ${this.quote(entity)} AS OLD ON ${keyCompare}` : ''
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
              ? ` COLLATE ${collations[this.context.locale] || collations[this.context.locale.split('_')[0]] || collations['']
              }`
              : '') +
            (c.sort === 'desc' || c.sort === -1 ? ' DESC' : ' ASC')
          : c => this.expr(c) + (c.sort === 'desc' || c.sort === -1 ? ' DESC' : ' ASC'),
      )
    }

    where(xpr) {
      xpr = { xpr }
      const suffix = this.is_comparator(xpr) ? '' : ' = TRUE'
      return `${this.xpr(xpr)}${suffix}`
    }

    having(xpr) {
      return this.where(xpr)
    }

    xpr(_xpr, caseSuffix = '') {
      const { xpr, _internal } = _xpr
      // Maps the compare operators to what to return when both sides are null
      const compareOperators = {
        '==': true,
        '!=': false,
        // These operators are not allowed in column expressions
        /* REVISIT: Only adjust these operators when inside the column expression
        '=': null,
        '>': null,
        '<': null,
        '<>': null,
        '>=': null,
        '<=': null,
        '!<': null,
        '!>': null,
        */
      }

      let endWithCompare = false
      if (!_internal) {
        for (let i = 0; i < xpr.length; i++) {
          let x = xpr[i]
          if (typeof x === 'string') {
            // Convert =, == and != into is (not) null operator where required
            x = xpr[i] = super.operator(xpr[i], i, xpr)

            // HANA does not support comparators in all clauses (e.g. SELECT 1>0 FROM DUMMY)
            // HANA does not have an 'IS' or 'IS NOT' operator
            if (x in compareOperators) {
              endWithCompare = true
              const left = xpr[i - 1]
              const right = xpr[i + 1]
              const ifNull = compareOperators[x]

              const compare = [left, x, right]

              const expression = {
                xpr: ['CASE', 'WHEN', ...compare, 'THEN', { val: true }, 'WHEN', 'NOT', ...compare, 'THEN', { val: false }],
                _internal: true,
              }

              if (ifNull != null) {
                // If at least one of the sides is NULL it will go into ELSE
                // This case checks if both sides are NULL and return their result
                expression.xpr.push('ELSE', {
                  xpr: [
                    'CASE',
                    'WHEN',
                    ...[left, 'IS', 'NULL', 'AND', right, 'IS', 'NULL'],
                    'THEN',
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
              xpr[i + 1] = ''
            }
          }
        }
      }

      const sql = []
      for (let i = 0; i < xpr.length; ++i) {
        const x = xpr[i]
        if (typeof x === 'string') {
          const up = x.toUpperCase()
          if (up in logicOperators) {
            // Force current expression to end with a comparison
            endWithCompare = true
          }
          if (endWithCompare && (up in caseOperators || up === ')')) {
            endWithCompare = false
          }
          sql.push(this.operator(x, i, xpr))
        } else if (x.xpr) sql.push(`(${this.xpr(x, caseSuffix)})`)
        // default
        else sql.push(this.expr(x))
      }

      if (endWithCompare) {
        const suffix = this.operator('OR', xpr.length, xpr).slice(0, -3)
        if (suffix) {
          sql.push(suffix)
        }
      }

      return `${sql.join(' ')}`
    }

    operator(x, i, xpr) {
      const up = x.toUpperCase()
      // Add "= TRUE" before THEN in case statements
      if (
        up in logicOperators &&
        !this.is_comparator({ xpr }, i - 1)
      ) {
        return ` = TRUE ${x}`
      }
      if (
        (up === 'LIKE' && is_regexp(xpr[i + 1]?.val)) ||
        up === 'REGEXP'
      ) return 'LIKE_REGEXPR'
      else return x
    }

    get is_distinct_from_() { return '!=' }
    get is_not_distinct_from_() { return '==' }

    /**
     * Checks if the xpr is a comparison or a value
     * @param {} xpr
     * @returns
     */
    is_comparator({ xpr }, start) {
      const local = start != null
      for (let i = start ?? xpr.length; i > -1; i--) {
        const cur = xpr[i]
        if (cur == null) continue
        if (typeof cur === 'string') {
          const up = cur.toUpperCase()
          // When a compare operator is found the expression is a comparison
          if (up in compareOperators || (!local && up in logicOperators)) return true
          // When a case operator is found it is the start of the expression
          if (up in caseOperators) break
          continue
        }
        if ('xpr' in cur) return this.is_comparator(cur)
      }
      return false
    }

    list(list) {
      const first = list.list[0]
      // If the list only contains of lists it is replaced with a json function and a placeholder
      if (this.values && first.list && !first.list.find(v => !v.val)) {
        const extraction = first.list.map((v, i) => `"${i}" ${this.constructor.InsertTypeMap[typeof v.val]()} PATH '$.V${i}'`)
        this.values.push(JSON.stringify(list.list.map(l => l.list.reduce((l, c, i) => { l[`V${i}`] = c.val; return l }, {}))))
        return `(SELECT * FROM JSON_TABLE(?, '$' COLUMNS(${extraction})))`
      }
      // Call super for normal SQL behavior
      return super.list(list)
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
          .filter(e => {
            if (elements[e]?.virtual) return false
            if (columns.find(c => c.name === e)) return false
            if (elements[e]?.[annotation]) return true
            if (!isUpdate && elements[e]?.default) return true
            return false
          })
          .map(name => ({ name, sql: 'NULL' }))

      const keyZero = this.quote(
        ObjectKeys(elements).find(e => {
          const el = elements[e]
          return el.key && !el.isAssociation
        }) || '',
      )

      return [...columns, ...requiredColumns].map(({ name, sql }) => {
        const element = elements?.[name] || {}
        // Don't apply input converters for place holders
        const converter = (sql !== '?' && element[inputConverterKey]) || (e => e)
        const val = _managed[element[annotation]?.['=']]
        let managed
        if (val) managed = this.func({ func: 'session_context', args: [{ val, param: false }] })
        let extract = sql ?? `${this.quote(name)} ${this.insertType4(element)} PATH '$.${name}'`
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
      Int16: () => 'INT',
      UUID: () => `NVARCHAR(36)`,
      Boolean: () => `NVARCHAR(5)`,
      LargeString: () => `NVARCHAR(2147483647)`,
      LargeBinary: () => `NVARCHAR(2147483647)`,
      Binary: () => `NVARCHAR(2147483647)`,
      array: () => `NVARCHAR(2147483647)`,
      Vector: () => `NVARCHAR(2147483647)`,

      // JavaScript types
      string: () => `NVARCHAR(2147483647)`,
      number: () => `DOUBLE`
    }

    // HANA JSON_TABLE function does not support BOOLEAN types
    static InputConverters = {
      ...super.InputConverters,
      // REVISIT: BASE64_DECODE has stopped working
      // Unable to convert NVARCHAR to UTF8
      // Not encoded string with CESU-8 or some UTF-8 except a surrogate pair at "base64_decode" function
      Binary: e => `HEXTOBIN(${e})`,
      Boolean: e => `CASE WHEN ${e} = 'true' THEN TRUE WHEN ${e} = 'false' THEN FALSE END`,
      Vector: e => `TO_REAL_VECTOR(${e})`,
    }

    static OutputConverters = {
      ...super.OutputConverters,
      // REVISIT: binaries should use BASE64_ENCODE, but this results in BASE64_ENCODE(BINTONHEX(${e}))
      Binary: e => `BINTONHEX(${e})`,
      Date: e => `to_char(${e}, 'YYYY-MM-DD')`,
      Time: e => `to_char(${e}, 'HH24:MI:SS')`,
      DateTime: e => `to_char(${e}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
      Timestamp: e => `to_char(${e}, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')`,
      Vector: e => `TO_NVARCHAR(${e})`,
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
      req.query = req.query.replace(/ IF EXISTS/gi, '')
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

  onBEGIN() {
    DEBUG?.('BEGIN')
    return this.dbc?.begin()
  }

  onCOMMIT() {
    DEBUG?.('COMMIT')
    return this.dbc?.commit()
  }

  onROLLBACK() {
    DEBUG?.('ROLLBACK')
    return this.dbc?.rollback()
  }

  // Creates a new database using HDI container groups
  async database({ database }, clean = false) {
    if (clean) {
      // Reset back to system credentials
      this.options.credentials = this.options.credentials.__system__
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

      const stmt = await this.dbc.prepare(createContainerDatabase)
      const res = await stmt.run([creds.user, creds.password, creds.containerGroup, !clean])
      res && DEBUG?.(res.changes.map(r => r.MESSAGE).join('\n'))
    } finally {
      if (this.dbc) {
        // Release table lock
        await this.onCOMMIT()

        await this.dbc.disconnect()
        delete this.dbc

        // Update credentials to new Database owner
        await this.disconnect()
        this.options.credentials = Object.assign({}, this.options.credentials, creds, {
          __system__: this.options.credentials,
        })
      }
    }
  }

  // Creates a new HDI container inside the database container group
  // As the tenants are located in a specific container group the containers can have the same name
  // This removes SCHEMA name conflicts when testing in the same system
  // Additionally this allows for deploying using the HDI procedures
  async tenant({ database, tenant }, clean = false) {
    if (clean) {
      // Reset back to database credentials
      this.options.credentials = this.options.credentials.__database__
    }

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

      const stmt = await this.dbc.prepare(createContainerTenant.replaceAll('{{{GROUP}}}', creds.containerGroup))
      const res = await stmt.run([creds.user, creds.password, creds.schema, !clean])
      res && DEBUG?.(res.changes.map(r => r.MESSAGE).join('\n'))
    } finally {
      await this.dbc.disconnect()
      delete this.dbc
    }
    // Update credentials to new Tenant owner
    await this.disconnect()
    this.options.credentials = Object.assign({}, this.options.credentials, creds, {
      __database__: this.options.credentials,
    })
  }
}
const createContainerDatabase = fs.readFileSync(path.resolve(__dirname, 'scripts/container-database.sql'), 'utf-8')
const createContainerTenant = fs.readFileSync(path.resolve(__dirname, 'scripts/container-tenant.sql'), 'utf-8')

Buffer.prototype.toJSON = function () {
  return this.toString('hex')
}

function _not_unique(err, code) {
  if (err.code === 301)
    return Object.assign(err, {
      originalMessage: err.message, // FIXME: required because of next line
      message: code, // FIXME: misusing message as code
      code: 400, // FIXME: misusing code as (http) status
    })
  return err
}

const is_regexp = x => x?.constructor?.name === 'RegExp' // NOTE: x instanceof RegExp doesn't work in repl
const ObjectKeys = o => (o && [...ObjectKeys(o.__proto__), ...Object.keys(o)]) || []
const _managed = {
  '$user.id': '$user.id',
  $user: '$user.id',
  $now: '$now',
}

const caseOperators = {
  'CASE': 1,
  'WHEN': 1,
  'THEN': 1,
  'ELSE': 1,
}
const logicOperators = {
  'THEN': 1,
  'AND': 1,
  'OR': 1,
}
const compareOperators = {
  '=': 1,
  '==': 1,
  '!=': 1,
  '>': 1,
  '<': 1,
  '<>': 1,
  '>=': 1,
  '<=': 1,
  '!<': 1,
  '!>': 1,
  'IS': 1,
  'IN': 1,
  'LIKE': 1,
  'IS NOT': 1,
  'EXISTS': 1,
  'BETWEEN': 1,
}

module.exports = HANAService
