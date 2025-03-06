const fs = require('fs')
const path = require('path')
const { Readable } = require('stream')

const { SQLService } = require('@cap-js/db-service')
const drivers = require('./drivers')
const cds = require('@sap/cds')
const collations = require('./collations.json')
const keywords = cds.compiler.to.hdi.keywords
// keywords come as array
const hanaKeywords = keywords.reduce((prev, curr) => {
  prev[curr] = 1
  return prev
}, {})

const DEBUG = cds.debug('sql|db')
let HANAVERSION = 0
const SANITIZE_VALUES = process.env.NODE_ENV === 'production' && cds.env.log.sanitize_values !== false

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
    this.on(['SELECT', 'INSERT', 'UPSERT', 'UPDATE', 'DELETE'], this.onNOTFOUND)
    return super.init()
  }

  // REVISIT: Add multi tenant factory when clarified
  get factory() {
    const driver = drivers[this.options.driver || this.options.credentials?.driver]?.driver || drivers.default.driver
    const service = this
    const { credentials, kind, client: clientOptions = {} } = service.options
    if (!credentials) {
      throw new Error(`Database kind "${kind}" configured, but no HDI container or Service Manager instance bound to application.`)
    }
    const isMultitenant = !!service.options.credentials.sm_url || ('multiTenant' in this.options ? this.options.multiTenant : cds.env.requires.multitenancy)
    const acquireTimeoutMillis = this.options.pool?.acquireTimeoutMillis || (cds.env.profiles.includes('production') ? 1000 : 10000)
    return {
      options: {
        min: 0,
        max: 10,
        acquireTimeoutMillis,
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
          const dbc = new driver({...credentials, ...clientOptions})
          await dbc.connect()
          HANAVERSION = dbc.server.major
          return dbc
        } catch (err) {
          if (isMultitenant) {
            // REVISIT: throw the error and break retry loop
            // Stop trying when the tenant does not exist or is rate limited
            if (err.status == 404 || err.status == 429)
              return new Promise(function (_, reject) {
                setTimeout(() => reject(err), acquireTimeoutMillis)
              })
          } else if (err.code !== 10) throw err
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
    return this.dbc || cds.error`Database connection is ${this._done || 'disconnected'}`
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

    if (!query.target || query.target._unresolved) {
      try { this.infer(query) } catch { /**/ }
    }
    if (!query.target || query.target._unresolved) {
      return super.onSELECT(req)
    }

    const isLockQuery = query.SELECT.forUpdate || query.SELECT.forShareLock
    if (!isLockQuery) {
      // REVISIT: disable this for queries like (SELECT 1)
      // Will return multiple rows with objects inside
      query.SELECT.expand = 'root'
    }

    const { cqn, sql, temporary, blobs, withclause, values } = this.cqn2sql(query, data)
    delete query.SELECT.expand

    const isSimple = temporary.length + blobs.length + withclause.length === 0

    // REVISIT: add prepare options when param:true is used
    let sqlScript = isLockQuery || isSimple ? sql : this.wrapTemporary(temporary, withclause, blobs)
    const { hints } = query.SELECT
    if (hints) sqlScript += ` WITH HINT (${hints.join(',')})`
    let rows
    if (values?.length || blobs.length > 0) {
      const ps = await this.prepare(sqlScript, blobs.length)
      rows = this.ensureDBC() && await ps.all(values || [])
    } else {
      rows = await this.exec(sqlScript)
    }

    if (isLockQuery) {
      // Fetch actual locked results
      const resultQuery = query.clone()
      resultQuery.SELECT.forUpdate = undefined
      resultQuery.SELECT.forShareLock = undefined
      return this.onSELECT({ query: resultQuery, __proto__: req })
    }

    if (rows.length && !isSimple) {
      rows = this.parseRows(rows)
    }
    if (cqn.SELECT.count) {
      // REVISIT: the runtime always expects that the count is preserved with .map, required for renaming in mocks
      return HANAService._arrayWithCount(rows, await this.count(query, rows))
    }
    return cqn.SELECT.one || query.SELECT.from.ref?.[0].cardinality?.max === 1 ? rows[0] : rows
  }

  async onINSERT({ query, data }) {
    try {
      const { sql, entries, cqn } = this.cqn2sql(query, data)
      if (!sql) return // Do nothing when there is nothing to be done
      const ps = await this.prepare(sql)
      // HANA driver supports batch execution
      const results = await (entries
        ? HANAVERSION <= 2
          ? entries.reduce((l, c) => l.then(() => this.ensureDBC() && ps.run(c)), Promise.resolve(0))
          : entries.length > 1 ? this.ensureDBC() && await ps.runBatch(entries) : this.ensureDBC() && await ps.run(entries[0])
        : this.ensureDBC() && ps.run())
      return new this.class.InsertResults(cqn, results)
    } catch (err) {
      throw _not_unique(err, 'ENTITY_ALREADY_EXISTS', data)
    }
  }

  async onUPDATE(req) {
    try {
      return await super.onUPDATE(req)
    } catch (err) {
      throw _not_unique(err, 'UNIQUE_CONSTRAINT_VIOLATION') || err
    }
  }

  async onNOTFOUND(req, next) {
    try {
      return await next()
    } catch (err) {
      // Ensure that the known entity still exists
      if (!this.context.tenant && err.code === 259 && typeof req.query !== 'string') {
        // Clear current tenant connection pool
        this.disconnect(this.context.tenant)
      }
      throw err
    }
  }

  // Allow for running complex expand queries in a single statement
  wrapTemporary(temporary, withclauses, blobs) {
    const blobColumn = b => `"${b.replace(/"/g, '""')}"`

    const values = temporary
      .map(t => {
        const blobColumns = blobs.map(b => (b in t.blobs) ? blobColumn(b) : `NULL AS ${blobColumn(b)}`)
        return blobColumns.length
          ? `SELECT "_path_","_blobs_","_expands_","_json_",${blobColumns} FROM (${t.select})`
          : t.select
      })

    const withclause = withclauses.length ? `WITH ${withclauses} ` : ''
    const pathOrder = ' ORDER BY "_path_" ASC'
    const ret = withclause + (
      values.length === 1
        ? values[0] + (values[0].indexOf(`SELECT '$[' as "_path_"`) < 0 ? pathOrder : '')
        : 'SELECT * FROM ' + values.map(v => `(${v})`).join(' UNION ALL ') + pathOrder
    )
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
      const data = Object.assign(JSON.parse(row._json_ || '{}'), expands, blobs)
      Object.keys(blobs).forEach(k => (data[k] = row[k] || data[k]))

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
            if (row._path_ !== level.path) {
              levels.push({
                data: data,
                path: row._path_,
                expands,
              })
            }
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
    const stmt = this.ensureDBC().prepare(sql, hasBlobs)
    // we store the statements, to release them on commit/rollback all at once
    this.dbc.statements.push(stmt)
    return stmt
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

      if (q.SELECT.from?.join && !q.SELECT.columns) {
        throw new Error('CQN query using joins must specify the selected columns.')
      }

      let { limit, one, distinct, from, orderBy, having, expand, columns = ['*'], localized, count, parent } = q.SELECT

      // When one of these is defined wrap the query in a sub query
      if (expand || (parent && (limit || one || orderBy))) {
        const walkAlias = q => {
          if (q.args) return q.as || walkAlias(q.args[0])
          if (q.SELECT?.from) return walkAlias(q.SELECT?.from)
          return q.as
        }
        const alias = q.as // Use query alias as path name
        q.as = walkAlias(q) // Use from alias for query re use alias
        q.alias = `${parent ? parent.alias + '.' : ''}${alias || q.as}`
        const src = q

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

        let orderByHasOutputColumnRef = false
        if (orderBy) {
          if (distinct) orderByHasOutputColumnRef = true
          // Ensure that all columns used in the orderBy clause are exposed
          orderBy = orderBy.map((c, i) => {
            if (!c.ref) {
              c.as = `$$ORDERBY_${i}$$`
              columns.push(c)
              return { __proto__: c, ref: [c.as], sort: c.sort }
            }
            if (c.ref?.length === 2) {
              const ref = c.ref + ''
              const match = columns.find(col => col.ref + '' === ref)
              if (!match) {
                c.as = `$$${c.ref.join('.')}$$`
                columns.push(c)
              }
              return { __proto__: c, ref: [this.column_name(match || c)], sort: c.sort }
            }
            orderByHasOutputColumnRef = true
            return c
          })
        }

        let hasBooleans = false
        let hasExpands = false
        let hasStructures = false
        const aliasedOutputColumns = outputColumns.map(c => {
          if (c.element?.type === 'cds.Boolean') hasBooleans = true
          if (c.elements && c.element?.isAssociation) hasExpands = true
          if (c.element?.type in this.BINARY_TYPES || c.elements || c.element?.elements || c.element?.items) hasStructures = true
          return c.elements ? c : { __proto__: c, ref: [this.column_name(c)] }
        })

        const isSimpleQuery = (
          cds.env.features.sql_simple_queries &&
          (cds.env.features.sql_simple_queries > 1 || !hasBooleans) &&
          !hasStructures &&
          !parent
        )

        const rowNumberRequired = parent // If this query has a parent it is an expand
          || (!isSimpleQuery && (orderBy || from.SELECT)) // If using JSON functions the _path_ is used for top level sorting
          || hasExpands // Expands depend on parent $$RN$$

        if (rowNumberRequired) {
          // Insert row number column for reducing or sorting the final result
          const over = { xpr: [] }
          // TODO: replace with full path partitioning
          if (parent) over.xpr.push(`PARTITION BY ${this.ref({ ref: ['_parent_path_'] })}`)
          if (orderBy?.length) over.xpr.push(` ORDER BY ${this.orderBy(orderBy, localized)}`)
          const rn = { xpr: [{ func: 'ROW_NUMBER', args: [] }, 'OVER', over], as: '$$RN$$' }
          q.as = q.SELECT.from.as

          q = cds.ql.SELECT(['*', rn]).from(q)
          q.as = q.SELECT.from.as
        }

        const outputAliasSimpleQueriesRequired = cds.env.features.sql_simple_queries
          && (orderByHasOutputColumnRef || having)
        if (outputAliasSimpleQueriesRequired || rowNumberRequired || q.SELECT.columns.length !== aliasedOutputColumns.length) {
          q = cds.ql.SELECT(aliasedOutputColumns).from(q)
          q.as = q.SELECT.from.as
          Object.defineProperty(q, 'elements', { value: elements })
          Object.defineProperty(q, 'element', { value: element })
        }

        if (rowNumberRequired && !q.SELECT.columns.find(c => c.as === '_path_')) {
          q.SELECT.columns.push({
            xpr: [
              {
                func: 'concat',
                args: parent
                  ? [
                    {
                      func: 'concat',
                      args: [{ ref: ['_parent_path_'] }, { val: `].${alias}[`, param: false }],
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
          if (limit && limit.rows == null) {
            // same error as in limit(), but for limits in expand
            throw new Error('Rows parameter is missing in SELECT.limit(rows, offset)')
          }

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

      if (expand === 'root' && this._outputColumns) {
        this.cqn = q
        const fromSQL = this.quote(this.name(q.src.alias))
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
      if (SELECT.expand !== 'root') {
        const ret = []
        for (const x of q.SELECT.columns) {
          if (x.elements && x.element?.isAssociation) continue
          ret.push(this.column_expr(x, q))
        }
        return ret
      }
      const structures = []
      const blobrefs = []
      let expands = {}
      let blobs = {}
      let hasBooleans = false
      let path
      let sql = []

      // Remove sub expands and track special return column types
      for (const x of SELECT.columns) {
        if (x === '*') sql.push('*')
        // means x is a sub select expand
        if (x.elements && x.element?.isAssociation) {
          if (x.SELECT?.count) {
            // Add count query to src query and output  query
            const cq = this.SELECT_count(x)
            src.SELECT.columns.push(cq)
            if (q !== src) q.SELECT.columns.push({ ref: [cq.as], element: cq.element })
          }

          expands[this.column_name(x)] = x.SELECT.one ? null : []

          const parent = src
          this.extractForeignKeys(x.SELECT.where, parent.as, []).forEach(ref => {
            const columnName = this.column_name(ref)
            if (!parent.SELECT.columns.find(c => this.column_name(c) === columnName)) {
              parent.SELECT.columns.push(ref)
            }
          })

          if (x.SELECT.from) {
            x.SELECT.from = {
              join: 'inner',
              args: [x.SELECT.from, { ref: [parent.alias], as: parent.as }],
              on: x.SELECT.where,
              as: x.SELECT.from.as,
            }
          } else {
            x.SELECT.from = { ref: [parent.alias], as: parent.as }
            x.SELECT.columns.forEach(col => {
              // if (col.ref?.length === 1) { col.ref.unshift(parent.as) }
              if (col.ref?.length > 1) {
                const colName = this.column_name(col)
                if (!parent.SELECT.columns.some(c => this.column_name(c) === colName)) {
                  const isSource = from => {
                    if (from.as === col.ref[0]) return true
                    return from.args?.some(a => {
                      if (a.args) return isSource(a)
                      return a.as === col.ref[0]
                    })
                  }

                  // Inject foreign columns into parent selects (recursively)
                  const as = `$$${col.ref.join('.')}$$`
                  let rename = col.ref[0] !== parent.as
                  let curPar = parent
                  while (curPar) {
                    if (isSource(curPar.SELECT.from)) {
                      if (curPar.SELECT.columns.find(c => c.as === as)) {
                        rename = true
                      } else {
                        rename = rename || curPar === parent
                        curPar.SELECT.columns.push(rename ? { __proto__: col, ref: col.ref, as } : { __proto__: col, ref: [...col.ref] })
                      }
                      break
                    } else {
                      curPar.SELECT.columns.push({ __proto__: col, ref: [curPar.SELECT.parent.as, as], as })
                      curPar = curPar.SELECT.parent
                    }
                  }
                  if (rename) {
                    col.as = colName
                    col.ref = [parent.as, as]
                  } else {
                    col.ref = [parent.as, colName]
                  }
                } else {
                  x.SELECT.from = { ref: [parent.alias], as: parent.as }
                  x.SELECT.columns.forEach(col => {
                    // if (col.ref?.length === 1) { col.ref.unshift(parent.as) }
                    if (col.ref?.length > 1) {
                      const colName = this.column_name(col)
                      if (!parent.SELECT.columns.some(c => !c.elements && this.column_name(c) === colName)) {
                        const isSource = from => {
                          if (from.as === col.ref[0]) return true
                          return from.args?.some(a => {
                            if (a.args) return isSource(a)
                            return a.as === col.ref[0]
                          })
                        }

                        // Inject foreign columns into parent selects (recursively)
                        const as = `$$${col.ref.join('.')}$$`
                        let rename = col.ref[0] !== parent.as
                        let curPar = parent
                        while (curPar) {
                          if (isSource(curPar.SELECT.from)) {
                            if (curPar.SELECT.columns.find(c => c.as === as)) {
                              rename = true
                            } else {
                              rename = rename || curPar === parent
                              curPar.SELECT.columns.push(rename ? { __proto__: col, ref: col.ref, as } : { __proto__: col, ref: [...col.ref] })
                            }
                            break
                          } else {
                            curPar.SELECT.columns.push({ __proto__: col, ref: [curPar.SELECT.parent.as, as], as })
                            curPar = curPar.SELECT.parent
                          }
                        }
                        if (rename) {
                          col.as = colName
                          col.ref = [parent.as, as]
                        } else {
                          col.ref = [parent.as, colName]
                        }
                      } else {
                        col.ref[1] = colName
                      }
                    }
                  })
                }
              }
            })
          }

          x.SELECT.where = undefined
          x.SELECT.expand = 'root'
          x.SELECT.parent = parent

          const values = this.values
          this.values = []
          parent.SELECT.expand = true
          this.SELECT(x)
          this.values = values
          continue
        }
        if (x.element?.type in this.BINARY_TYPES) {
          blobrefs.push(x)
          blobs[this.column_name(x)] = null
          continue
        }
        if (x.element?.elements || x.element?.items) {
          // support for structured types and arrays
          structures.push(x)
          continue
        }
        const columnName = this.column_name(x)
        if (columnName === '_path_') {
          path = this.expr(x)
          continue
        }
        if (x.element?.type === 'cds.Boolean') hasBooleans = true
        const converter = x.element?.[this.class._convertOutput] || (e => e)
        const s = x.param !== true && typeof x.val === 'number' ? this.expr({ param: false, __proto__: x }) : this.expr(x)
        sql.push(`${converter(s, x.element)} as "${columnName.replace(/"/g, '""')}"`)
      }

      this._blobs = blobs
      const blobColumns = Object.keys(blobs)
      this.blobs.push(...blobColumns.filter(b => !this.blobs.includes(b)))
      if (
        cds.env.features.sql_simple_queries &&
        (cds.env.features.sql_simple_queries > 1 || !hasBooleans) &&
        structures.length + ObjectKeys(expands).length + ObjectKeys(blobs).length === 0 &&
        !q?.src?.SELECT?.parent &&
        this.temporary.length === 0
      ) {
        return `${sql}`
      }

      expands = this.string(JSON.stringify(expands))
      blobs = this.string(JSON.stringify(blobs))
      // When using FOR JSON the whole dataset is put into a single blob
      // To increase the potential maximum size of the result set every row is converted to a JSON
      // Making each row a maximum size of 2gb instead of the whole result set to be 2gb
      // Excluding binary columns as they are not supported by FOR JSON and themselves can be 2gb
      const rawJsonColumn = sql.length
        ? `(SELECT ${path ? sql : sql.map(c => c.slice(c.lastIndexOf(' as "') + 4))} FROM JSON_TABLE('{}', '$' COLUMNS("'$$FaKeDuMmYCoLuMn$$'" FOR ORDINALITY)) FOR JSON ('format'='no', 'omitnull'='no', 'arraywrap'='no') RETURNS NVARCHAR(2147483647))`
        : `'{}'`

      let jsonColumn = rawJsonColumn
      if (structures.length) {
        // Appending the structured columns to prevent them from being quoted and escaped
        // In case of the deep JSON select queries the deep columns depended on a REGEXP_REPLACE which will probably be slower
        const structuresConcat = structures
          .map((x, i) => {
            const name = this.column_name(x)
            return `'${i ? ',' : '{'}"${name}":' || COALESCE(${this.quote(name)},'null')`
          })
          .join(' || ')
        jsonColumn = sql.length
          ? `${structuresConcat} || ',' || SUBSTRING(${rawJsonColumn}, 2)`
          : `${structuresConcat} || '}'`
      }

      // Calculate final output columns once
      let outputColumns = ''
      outputColumns = `${path ? this.quote('_path_') : `'$['`} as "_path_",${blobs} as "_blobs_",${expands} as "_expands_",${jsonColumn} as "_json_"`
      if (blobColumns.length)
        outputColumns = `${outputColumns},${blobColumns.map(b => `${this.quote(b)} as "${b.replace(/"/g, '""')}"`)}`
      this._outputColumns = outputColumns
      if (path) {
        sql = `*,${path} as ${this.quote('_path_')}`
      } else {
        structures.forEach(x => sql.push(this.column_expr(x)))
        blobrefs.forEach(x => sql.push(this.column_expr(x)))
      }
      return sql
    }

    SELECT_expand(_, sql) {
      return sql
    }

    SELECT_count(q) {
      const countQuery = super.SELECT_count(q)
      countQuery.SELECT.from = countQuery.SELECT.from
      countQuery.SELECT.where = countQuery.SELECT.where
      // Ensure that the query is not considered an expand query
      countQuery.SELECT.parent = undefined
      return countQuery
    }

    from_dummy() {
      return ' FROM DUMMY'
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
      const entity = q.target?.['@cds.persistence.name'] || this.name(q.target?.name || INSERT.into.ref[0], q)

      const elements = q.elements || q.target?.elements
      if (!elements) {
        return super.INSERT_entries(q)
      }

      const columns = elements
        ? ObjectKeys(elements).filter(c => c in elements && !elements[c].virtual && !elements[c].value && !elements[c].isAssociation)
        : ObjectKeys(INSERT.entries[0])
      this.columns = columns

      const extractions = this.managed(columns.map(c => ({ name: c })), elements)

      // REVISIT: @cds.extension required
      const extraction = extractions.map(c => c.extract)
      const converter = extractions.map(c => c.insert)

      const _stream = entries => {
        const stream = Readable.from(this.INSERT_entries_stream(entries, 'hex'), { objectMode: false })
        stream.setEncoding('utf-8')
        stream.type = 'json'
        stream._raw = entries
        return stream
      }

      // HANA Express does not process large JSON documents
      // The limit is somewhere between 64KB and 128KB
      if (HANAVERSION <= 2) {
        this.entries = INSERT.entries.map(e => (e instanceof Readable
          ? [e]
          : [_stream([e])]))
      } else {
        this.entries = [[
          INSERT.entries[0] instanceof Readable
            ? INSERT.entries[0]
            : _stream(INSERT.entries)
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
      SELECT ${converter} FROM JSON_TABLE(SRC.JSON, '$' COLUMNS(${extraction}) ERROR ON ERROR) AS NEW`)
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

      const columns = INSERT.columns || []
      for (const col of ObjectKeys(elements)) {
        if (!columns.includes(col)) columns.push(col)
      }

      const entries = new Array(INSERT.rows.length)
      const rows = INSERT.rows
      for (let x = 0; x < rows.length; x++) {
        const row = rows[x]
        const entry = {}
        for (let y = 0; y < columns.length; y++) {
          entry[columns[y]] = row[y]
            // Include explicit null values for managed fields
            ?? (elements[columns[y]]['@cds.on.insert'] && null)
        }
        entries[x] = entry
      }
      INSERT.entries = entries
      return this.INSERT_entries(q)
    }

    UPSERT(q) {
      const { UPSERT } = q
      // REVISIT: should @cds.persistence.name be considered ?
      const entity = q.target?.['@cds.persistence.name'] || this.name(q.target?.name || UPSERT.into.ref[0], q)
      const elements = q.target?.elements || {}
      const insert = this.INSERT({ __proto__: q, INSERT: UPSERT })

      let keys = q.target?.keys
      if (!keys) return insert
      keys = Object.keys(keys).filter(k => !keys[k].isAssociation && !keys[k].virtual)

      // temporal data
      keys.push(...ObjectKeys(q.target.elements).filter(e => q.target.elements[e]['@cds.valid.from']))

      const managed = this.managed(
        this.columns.map(c => ({ name: c })),
        elements
      )

      const keyCompare = managed
        .filter(c => keys.includes(c.name))
        .map(c => `${c.insert}=OLD.${this.quote(c.name)}`)
        .join(' AND ')

      const mixing = managed.map(c => c.upsert)
      const extraction = managed.map(c => c.extract)

      const sql = `WITH SRC AS (SELECT ? AS JSON FROM DUMMY UNION ALL SELECT TO_NCLOB(NULL) AS JSON FROM DUMMY)
SELECT ${mixing} FROM JSON_TABLE(SRC.JSON, '$' COLUMNS(${extraction})) AS NEW LEFT JOIN ${this.quote(entity)} AS OLD ON ${keyCompare}`

      return (this.sql = `UPSERT ${this.quote(entity)} (${this.columns.map(c => this.quote(c))}) ${sql}`)
    }

    DROP(q) {
      return (this.sql = super.DROP(q).replace('IF EXISTS', ''))
    }

    from_args(args) {
      return `(${ObjectKeys(args).map(k => `${this.quote(k)} => ${this.expr(args[k])}`)})`
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
            (c.sort?.toLowerCase() === 'desc' || c.sort === -1 ? ' DESC' : ' ASC')
          : c => this.expr(c) + (c.sort?.toLowerCase() === 'desc' || c.sort === -1 ? ' DESC' : ' ASC'),
      )
    }

    limit({ rows, offset }) {
      rows = { param: false, __proto__: rows }
      return super.limit({ rows, offset })
    }

    where(xpr) {
      xpr = { xpr, top: true }
      const suffix = this.is_comparator(xpr)
      return `${this.xpr(xpr, true)}${suffix ? '' : ` = ${this.val({ val: true })}`}`
    }

    having(xpr) {
      return this.where(xpr)
    }

    xpr(_xpr, iscompare) {
      let { xpr, top, _internal } = _xpr
      // Maps the compare operators to what to return when both sides are null
      const compareTranslations = {
        '==': true,
        '!=': false,
      }
      const expressionTranslations = { // These operators are not allowed in column expressions
        '==': true,
        '!=': false,
        '=': null,
        '>': null,
        '<': null,
        '<>': null,
        '>=': null,
        '<=': null,
        '!<': null,
        '!>': null,
      }

      if (!_internal) {
        const iscompareStack = [iscompare]
        for (let i = 0; i < xpr.length; i++) {
          let x = xpr[i]
          if (typeof x === 'string') {
            // IS (NOT) NULL translation when required
            if (x === '=' || x === '!=') {
              const left = xpr[i - 1]
              const right = xpr[i + 1]
              const leftType = left?.element?.type
              const rightType = right?.element?.type
              // Prevent HANA from throwing and unify nonsense behavior
              if (left?.val === null && rightType in lobTypes) {
                left.param = false // Force null to be inlined
                xpr[i + 1] = { param: false, val: null } // Remove illegal type ref for compare operator
              }
              if (right?.val === null) {
                if (
                  !leftType || // Literal translation when left hand type is unknown
                  leftType in lobTypes
                ) {
                  xpr[i] = x = x === '=' ? 'IS' : 'IS NOT'
                  right.param = false // Force null to be inlined
                } else {
                  x = x === '=' ? '==' : '!='
                }
              }
            }

            // const effective = x === '=' && xpr[i + 1]?.val === null ? '==' : x
            // HANA does not support comparators in all clauses (e.g. SELECT 1>0 FROM DUMMY)
            // HANA does not have an 'IS' or 'IS NOT' operator
            if (iscompareStack.at(-1) ? x in compareTranslations : x in expressionTranslations) {
              const left = xpr[i - 1]
              const right = xpr[i + 1]
              const ifNull = expressionTranslations[x]
              x = x === '==' ? '=' : x

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
                    // coalesce is used to match the left and right hand types in case one is a placeholder
                    ...[{ func: 'COALESCE', args: [left, right] }, 'IS', 'NULL'],
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
              xpr[i + 1] = iscompareStack.at(-1) ? ' = TRUE' : ''
            } else {
              const up = x.toUpperCase()
              if (up === 'CASE') iscompareStack.push(1)
              if (up === 'END') iscompareStack.pop()
              if (up in logicOperators && iscompareStack.length === 1) top = true
              if (up in caseOperators) {
                iscompareStack[iscompareStack.length - 1] = caseOperators[up]
              }
            }
          }
        }
      }

      const sql = []
      const iscompareStack = [iscompare]
      for (let i = 0; i < xpr.length; ++i) {
        const x = xpr[i]
        if (typeof x === 'string') {
          const up = x.toUpperCase()
          if (up === 'CASE') iscompareStack.push(1)
          if (up === 'END') iscompareStack.pop()
          if (up in caseOperators) {
            iscompareStack[iscompareStack.length - 1] = caseOperators[up]
          }
          sql.push(this.operator(x, i, xpr, top || iscompareStack.length > 1))
        } else if (x.xpr) sql.push(`(${this.xpr(x, iscompareStack.at(-1))})`)
        // default
        else sql.push(this.expr(x))
      }

      if (iscompare) {
        const suffix = this.operator('OR', xpr.length, xpr).slice(0, -3)
        if (suffix) {
          sql.push(suffix)
        }
      }

      return `${sql.join(' ')}`
    }

    operator(x, i, xpr, top) {
      const up = x.toUpperCase()
      // Add "= TRUE" before THEN in case statements
      if (
        up in logicOperators &&
        logicOperators[up] &&
        this.is_comparator({ xpr, top }, i - 1) === false
      ) {
        return ` = ${this.val({ val: true })} ${x}`
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
    is_comparator({ xpr, top }, start) {
      const local = start != null
      for (let i = start ?? xpr.length; i > -1; i--) {
        const cur = xpr[i]
        if (cur == null) continue
        if (typeof cur === 'string') {
          const up = cur.toUpperCase()
          // When a logic operator is found the expression is not a comparison
          // When it is a local check it cannot be compared outside of the xpr
          if (up in logicOperators) {
            // ensure AND is not part of BETWEEN
            if (up === 'AND' && xpr[i - 2]?.toUpperCase?.() in { 'BETWEEN': 1, 'NOT BETWEEN': 1 }) return true
            // ensure NOT is not part of a compare operator
            if (up === 'NOT' && xpr[i - 1]?.toUpperCase?.() in compareOperators) return true
            return !local
          }
          // When a compare operator is found the expression is a comparison
          if (up in compareOperators) return true
          // When there is an END of a case statement walk around it to keep checking
          if (up === 'END') {
            let casedepth = 0
            for (; i > -1; i--) {
              const up = xpr[i]?.toUpperCase?.()
              if (up === 'END') casedepth++
              if (up === 'CASE') casedepth--
              if (casedepth === 0) break
            }
            if (casedepth > 0) return false
          }
          // When a case operator is found it is the start of the expression
          if (up in caseOperators) return false
          continue
        }
        if (cur.func?.toUpperCase() === 'CONTAINS' && cur.args?.length > 2) return true
        if ('_internal' in cur) return true
        if ('xpr' in cur) {
          const nested = this.is_comparator(cur)
          if (nested) return true
        }
      }
      return top ? false : 0
    }

    list(list) {
      const first = list.list[0]
      // If the list only contains of lists it is replaced with a json function and a placeholder
      if (this.values && first.list && !first.list.find(v => v.val == null)) {
        const listMapped = []
        for (let l of list.list) {
          const obj = {}
          for (let i = 0; i < l.list.length; i++) {
            const c = l.list[i]
            if (Buffer.isBuffer(c.val)) {
              return super.list(list)
            }
            obj[`V${i}`] = c.val
          }
          listMapped.push(obj)
        }
        this.values.push(JSON.stringify(listMapped))
        const extraction = first.list.map((v, i) => `"${i}" ${this.constructor.InsertTypeMap[typeof v.val]()} PATH '$.V${i}'`)
        return `(SELECT * FROM JSON_TABLE(?, '$' COLUMNS(${extraction})))`
      }
      // If the list only contains of vals it is replaced with a json function and a placeholder
      if (this.values && first.val != null) {
        for (let c of list.list) {
          if (Buffer.isBuffer(c.val)) {
            return super.list(list)
          }
        }
        const v = first
        const extraction = `"val" ${this.constructor.InsertTypeMap[typeof v.val]()} PATH '$.val'`
        this.values.push(JSON.stringify(list.list))
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
      if (s in this.class.ReservedWords || !/^[A-Za-z_][A-Za-z_$#0-9]*$/.test(s)) return '"' + s.toUpperCase() + '"'
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

    managed_extract(name, element, converter) {
      // TODO: test property names with single and double quotes
      return {
        extract: `${this.quote(name)} ${this.insertType4(element)} PATH '$.${name}', ${this.quote('$.' + name)} NVARCHAR(2147483647) FORMAT JSON PATH '$.${name}'`,
        sql: converter(`NEW.${this.quote(name)}`),
      }
    }

    managed_default(name, managed, src) {
      return `(CASE WHEN ${this.quote('$.' + name)} IS NULL THEN ${managed} ELSE ${src} END)`
    }

    // Loads a static result from the query `SELECT * FROM RESERVED_KEYWORDS`
    static ReservedWords = { ...super.ReservedWords, ...hanaKeywords }

    static Functions = { ...super.Functions, ...require('./cql-functions') }

    static TypeMap = {
      ...super.TypeMap,
    }

    // TypeMap used for the JSON_TABLE column definition
    static InsertTypeMap = {
      ...super.TypeMap,
      UInt8: () => 'INT',
      Int16: () => 'INT',
      Int64: () => `BIGINT`,
      UUID: () => `NVARCHAR(36)`,
      Boolean: () => `NVARCHAR(5)`,
      String: e => `NVARCHAR(${(e.length || 5000) * 4})`,
      LargeString: () => `NVARCHAR(2147483647)`,
      LargeBinary: () => `NVARCHAR(2147483647)`,
      Binary: () => `NVARCHAR(2147483647)`,
      array: () => `NVARCHAR(2147483647) FORMAT JSON`,
      Map: () => `NVARCHAR(2147483647) FORMAT JSON`,
      Vector: () => `NVARCHAR(2147483647)`,
      Decimal: () => `DECIMAL`,

      // JavaScript types
      string: () => `NVARCHAR(2147483647)`,
      number: () => `DOUBLE`,
      boolean: () => `NVARCHAR(5)`,

      // HANA types
      'cds.hana.TINYINT': () => 'INT',
      'cds.hana.REAL': () => 'DECIMAL',
      'cds.hana.CHAR': e => `NVARCHAR(${(e.length || 1) * 4})`,
      'cds.hana.ST_POINT': () => 'NVARCHAR(2147483647)',
      'cds.hana.ST_GEOMETRY': () => 'NVARCHAR(2147483647)',
    }

    // HANA JSON_TABLE function does not support BOOLEAN types
    static InputConverters = {
      ...super.InputConverters,

      // REVISIT: BASE64_DECODE has stopped working
      // Unable to convert NVARCHAR to UTF8
      // Not encoded string with CESU-8 or some UTF-8 except a surrogate pair at "base64_decode" function
      Binary: e => e === '?' ? e : `HEXTOBIN(${e})`,
      Boolean: e => e === '?' ? e : `CASE WHEN ${e} = 'true' OR ${e} = '1' THEN TRUE WHEN ${e} = 'false' OR ${e} = '0' THEN FALSE END`,
      // TODO: Decimal: (expr, element) => element.precision ? `TO_DECIMAL(${expr},${element.precision},${element.scale})` : expr

      // Types that require input converters for placeholders as well
      Vector: e => `TO_REAL_VECTOR(${e})`,
      // HANA types
      'cds.hana.ST_POINT': e => `TO_POINT(${e})`,
      'cds.hana.ST_GEOMETRY': e => `TO_GEOMETRY(${e})`,
    }

    static OutputConverters = {
      ...super.OutputConverters,
      LargeString: cds.env.features.sql_simple_queries > 0 ? e => `TO_NVARCHAR(${e})` : undefined,
      // REVISIT: binaries should use BASE64_ENCODE, but this results in BASE64_ENCODE(BINTONHEX(${e}))
      Binary: e => `BINTONHEX(${e})`,
      Date: e => `to_char(${e}, 'YYYY-MM-DD')`,
      Time: e => `to_char(${e}, 'HH24:MI:SS')`,
      DateTime: e => `to_char(${e}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
      Timestamp: e => `to_char(${e}, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')`,
      Vector: e => `TO_NVARCHAR(${e})`,
      // Reading int64 as string to not loose precision
      Int64: expr => `TO_NVARCHAR(${expr})`,
      // Reading decimal as string to not loose precision
      Decimal: (expr, elem) => elem?.scale
        ? `TO_NVARCHAR(${expr}, '0.${''.padEnd(elem.scale, '0')}')`
        : `TO_NVARCHAR(${expr})`,

      // HANA types
      'cds.hana.ST_POINT': e => `TO_NVARCHAR(${e})`,
      'cds.hana.ST_GEOMETRY': e => `TO_NVARCHAR(${e})`,
    }
  }

  async onSIMPLE({ query, data, event }) {
    const { sql, values } = this.cqn2sql(query, data)
    try {
      let ps = await this.prepare(sql)
      return (this.ensureDBC() && await ps.run(values)).changes
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
    if (Array.isArray(req.query) && !req.query.find(q => typeof q !== 'string' || this.hasResults(q))) {
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

  async onCall({ query, data }, name, schema) {
    const outParameters = await this._getProcedureMetadata(name, schema)
    const ps = await this.prepare(query)
    return this.ensureDBC() && ps.proc(data, outParameters)
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

    const proc = this._getProcedureNameAndSchema(req.query)
    if (proc && proc.name) return this.onCall(req, proc.name, proc.schema)

    return super.onPlainSQL(req, next)
  }

  onBEGIN() {
    DEBUG?.('BEGIN')
    if (this.dbc) this.dbc.statements = []
    return this.dbc?.begin()
  }

  onCOMMIT() {
    DEBUG?.('COMMIT')
    this.dbc?.statements?.forEach(stmt => stmt
      .then(stmt => stmt.drop())
      .catch(() => { })
    )
    return this.dbc?.commit()
  }

  onROLLBACK() {
    DEBUG?.('ROLLBACK')
    this.dbc?.statements?.forEach(stmt => stmt
      .then(stmt => stmt.drop())
      .catch(() => { })
    )
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
      const res = this.ensureDBC() && await stmt.run([creds.user, creds.password, creds.containerGroup, !clean])
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

      let i = 0
      let err
      for (; i < 100; i++) {
        try {
          const stmt = await this.dbc.prepare(createContainerTenant.replaceAll('{{{GROUP}}}', creds.containerGroup))
          const res = this.ensureDBC() && await stmt.run([creds.user, creds.password, creds.schema, !clean])
          res && DEBUG?.(res.changes.map?.(r => r.MESSAGE).join('\n'))
          break
        } catch (e) {
          err = e
        }
      }
      if (i === 100) {
        throw new Error(`Failed to create tenant: ${err.message || err.stack || err}`)
      }
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

  async _getProcedureMetadata(name, schema) {
    const sqlString = this.class.CQN2SQL.prototype.string
    name = typeof name === 'string' ? sqlString(name) : `'${name}'`
    schema = typeof schema === 'string' ? sqlString(schema) : 'CURRENT_SCHEMA'
    const query = `SELECT PARAMETER_NAME FROM SYS.PROCEDURE_PARAMETERS WHERE SCHEMA_NAME = ${schema} AND PROCEDURE_NAME = ${name} AND PARAMETER_TYPE IN ('OUT', 'INOUT') ORDER BY POSITION`
    return await super.onPlainSQL({ query, data: [] })
  }

  _getProcedureNameAndSchema(sql) {
    // name delimited with "" allows any character
    const match = sql
      .match(
        /^\s*call \s*(("(?<schema_delimited>\w+)"\.)?("(?<delimited>.+)")|((?<schema_undelimited>\w+)\.)?(?<undelimited>\w+))\s*\(/i
      )
    return (
      match && {
        name: match.groups.undelimited ?? match.groups.delimited,
        schema: match.groups.schema_delimited || match.groups.schema_undelimited
      }
    )
  }
}
const createContainerDatabase = fs.readFileSync(path.resolve(__dirname, 'scripts/container-database.sql'), 'utf-8')
const createContainerTenant = fs.readFileSync(path.resolve(__dirname, 'scripts/container-tenant.sql'), 'utf-8')

function _not_unique(err, code, data) {
  if (err.code === 301)
    return Object.assign(err, {
      originalMessage: err.message, // FIXME: required because of next line
      message: code, // FIXME: misusing message as code
      code: 400, // FIXME: misusing code as (http) status
    })
  if (data) err.values = SANITIZE_VALUES ? ['***'] : data
  return err
}

const is_regexp = x => x?.constructor?.name === 'RegExp' // NOTE: x instanceof RegExp doesn't work in repl
const ObjectKeys = o => (o && [...ObjectKeys(o.__proto__), ...Object.keys(o)]) || []

// All case key words and whether they start an comparison or an expression
const caseOperators = {
  'CASE': 1,
  'WHEN': 1,
  'THEN': 0,
  'ELSE': 0,
}
// All logic operators and whether they have a left hand comparison
const logicOperators = {
  'THEN': 1,
  'AND': 1,
  'OR': 1,
  'NOT': 0,
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
  'IS': 1,
  'IN': 1,
  'NOT IN': 1,
  'LIKE': 1,
  'NOT LIKE': 1,
  'IS NOT': 1,
  'EXISTS': 1,
  'NOT EXISTS': 1,
  'BETWEEN': 1,
  'NOT BETWEEN': 1,
  'CONTAINS': 1,
  'MEMBER OF': 1,
  'NOT MEMBER OF': 1,
  'LIKE_REGEXPR': 1,
}
const lobTypes = {
  'cds.LargeBinary': 1,
  'cds.LargeString': 1,
  'cds.hana.CLOB': 1,
}

module.exports = HANAService
