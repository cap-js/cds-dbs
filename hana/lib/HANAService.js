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
    return {
      options: { max: 1, ...this.options.pool },
      create: async (/*tenant*/) => {
        const driver = drivers[this.options.driver || this.options.credentials.driver]?.driver || drivers.default.driver
        const dbc = new driver(this.options.credentials)
        await dbc.connect()
        HANAVERSION = dbc.server.major
        return dbc
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
    // REVISIT: required to be compatible with generated views
    if (variables['$valid.from']) variables['VALID-FROM'] = variables['$valid.from']
    if (variables['$valid.to']) variables['VALID-TO'] = variables['$valid.to']

    this.dbc.set(variables)
  }

  async onSELECT({ query, data }) {
    // REVISIT: disable this for queries like (SELECT 1)
    // Will return multiple rows with objects inside
    query.SELECT.expand = 'root'
    const { cqn, temporary, blobs } = this.cqn2sql(query, data)
    // REVISIT: add prepare options when param:true is used
    const sqlScript = this.wrapTemporary(temporary, blobs)
    let rows = await this.exec(sqlScript)
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
    // Using runBatch for HANA 2.0 and lower sometimes leads to integer underflow errors
    // REVISIT: Address runBatch issues in node-hdb and hana-client
    if (HANAVERSION <= 2) {
      return super.onINSERT(...arguments)
    }
    const { sql, entries, cqn } = this.cqn2sql(query, data)
    if (!sql) return // Do nothing when there is nothing to be done
    const ps = await this.prepare(sql)
    // HANA driver supports batch execution
    const results = entries ? await ps.runBatch(entries) : await ps.run()
    return new this.class.InsertResults(cqn, results)
  }

  async onSTREAM(req) {
    let { cqn, sql, values, temporary, blobs } = this.cqn2sql(req.query)
    // writing stream
    if (req.query.STREAM.into) {
      const ps = await this.prepare(sql)
      return (await ps.run(values)).changes
    }
    // reading stream
    if (temporary?.length) {
      // Full SELECT CQN support streaming
      sql = this.wrapTemporary(temporary, blobs)
    }
    const ps = await this.prepare(sql)
    const stream = await ps.stream(values, cqn.SELECT?.one)
    if (cqn.SELECT?.count) stream.$count = await this.count(req.query.STREAM.from)
    return stream
  }

  // Allow for running complex expand queries in a single statement
  wrapTemporary(temporary, blobs) {
    const blobColumn = b => `"${b.replace(/"/g, '""')}"`

    const values = temporary
      .map(t => {
        if (blobs.length) {
          const localBlobs = JSON.parse(/'(.*?)' as _blobs_/.exec(t.select)[1])
          const blobColumns = blobs.filter(b => !(b in localBlobs)).map(b => `NULL AS ${blobColumn(b)}`)
          if (blobColumns.length) return `${t.as} = SELECT ${blobColumns},${t.select};`
        }
        return `${t.as} = SELECT ${t.select};`
      })
      .join('')

    const blobColumns = blobs.length ? `,${blobs.map(blobColumn).join()}` : ''
    const unions = temporary
      .map(t => {
        return `SELECT _path_ as "_path_",_blobs_ as "_blobs_",_expands_ as "_expands_",_json_ as "_json_"${blobColumns} FROM :${t.as}`
      })
      .join(' UNION ALL ')

    const ret = temporary.length === 1
      ? `SELECT _path_ as "_path_",_blobs_ as "_blobs_",_expands_ as "_expands_",_json_ as "_json_"${blobColumns} FROM (SELECT ${temporary[0].select})`
      : `DO BEGIN ${values} SELECT * FROM (${unions}) ORDER BY "_path_" ASC; END;`
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
            level.data.push(data)
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

    static _init() {
      this._insertType = this._add_mixins(':insertType', this.InsertTypeMap)
      return super._init()
    }

    SELECT(q) {
      // Collect all queries and blob columns of all queries
      this.temporary = this.temporary || []
      this.blobs = this.blobs || []

      const orgQuery = q
      q = cds.ql.clone(q)
      const { limit, one, orderBy, expand, columns, localized, count, from, parent, property } = q.SELECT
      // Ignore one and limit as HANA does not support LIMIT on sub queries
      q.SELECT.one = undefined
      q.SELECT.limit = undefined
      q.SELECT.orderBy = undefined
      // Track and expose foreign keys for follow up expand queries
      let foreignKeys = []

      // When one of these is defined wrap the query in a sub query
      if (expand || limit || one || orderBy) {
        if (expand === 'root') this.values = undefined

        q.SELECT.expand = false

        if (expand === 'root') {
          const flatExpands = this.SELECT_expand_flat(orgQuery, ['$'])
          foreignKeys = this.foreignKeys = flatExpands.foreignKeys
        }

        // Convert columns to pure references
        const outputColumns = columns
          .map(c => {
            if (c === '*') return c
            return {
              ref: [this.column_name(c)],
              elements: c.elements,
              element: c.element,
              one: !!c.SELECT?.one,
            }
          })
          .filter(a => a)

        // Only enhance columns after output columns are calculated
        const enhanceColumns = c => {
          const ref = c.ref + ''
          if (!columns.find(c => c.ref + '' === ref)) {
            const clone = { __proto__: c, ref: c.ref }
            columns.push(clone)
          }
        }

        if (parent) {
          columns.push({ ref: [parent, '_path_'], as: '_parent_path_' })
        }
        foreignKeys.forEach(enhanceColumns)

        if (orderBy) {
          // Ensure that all columns used in the orderBy clause are exposed
          orderBy.forEach(c => {
            if (c.ref?.length === 2) {
              enhanceColumns(c)
              c.ref = [c.ref[1]]
            }
          })
        }

        // Insert row number column for reducing or sorting the final result
        const over = { xpr: [] }
        if (parent) over.xpr.push(`PARTITION BY _parent_path_`)
        if (orderBy) over.xpr.push(` ORDER BY ${this.orderBy(orderBy, localized)}`)
        const rn = { xpr: [{ func: 'ROW_NUMBER', args: [] }, 'OVER', over], as: '$$RN$$' }
        q = cds.ql.SELECT(['*', rn]).from(q)

        q.SELECT.columns.push({
          xpr: [
            {
              func: 'concat',
              args: parent
                ? [
                    {
                      func: 'concat',
                      args: [{ ref: ['_parent_path_'] }, { val: `].${property}[` }],
                    },
                    { func: 'lpad', args: [rn, { val: 6 }, { val: '0' }] },
                  ]
                : [{ val: '$[' }, { func: 'lpad', args: [rn, { val: 6 }, { val: '0' }] }],
            },
          ],
          as: '_new_path_',
        })

        // Remove any internal columns added (e.g. orderBy and $$RN$$)
        q = cds.ql.SELECT(outputColumns).from(q)

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
        Object.defineProperty(q, 'elements', { value: orgQuery.elements })
        // Set new query as root cqn
        if (expand === 'root') {
          this.cqn = q
        }
      }

      super.SELECT(q)

      // Set one and limit back to the query for onSELECT handler
      q.SELECT.one = one
      q.SELECT.limit = limit

      if (expand === 'root') {
        this.temporary.unshift({ as: this.quote(from.as), select: this.sql.substring(7) })
      }

      return this.sql
    }

    SELECT_columns({ SELECT }) {
      if (!SELECT.columns) return '*'
      const structures = []
      let expands = {}
      let blobs = {}
      let sql = SELECT.columns
        .map(
          SELECT.expand
            ? x => {
                if (x === '*') return '*'
                // means x is a sub select expand
                if (x.elements) {
                  expands[this.column_name(x)] = x.one ? null : []
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
                const converter = x.element?.[this.class._convertOutput] || (e => e)
                return `${converter(xpr)} as "${this.column_name(x).replace(/"/g, '""')}"`
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
        const blobColumns = Object.keys(blobs)
        this.blobs.push(...blobColumns.filter(b => !this.blobs.includes(b)))
        expands = this.string(JSON.stringify(expands))
        blobs = this.string(JSON.stringify(blobs))
        // When using FOR JSON the whole dataset is put into a single blob
        // To increase the potential maximum size of the result set every row is converted to a JSON
        // Making each row a maximum size of 2gb instead of the whole result set to be 2gb
        // Excluding binary columns as they are not supported by FOR JSON and themselves can be 2gb
        const rawJsonColumn = sql.length
          ? `(SELECT ${sql} FROM DUMMY FOR JSON ('format'='no', 'omitnull'='no', 'arraywrap'='no') RETURNS NVARCHAR(2147483647)) AS _json_`
          : `TO_NCLOB('{}') AS _json_`

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
            ? `SUBSTRING(_json_, 1, LENGTH(_json_) - 1) || ${structuresConcat} || '}' as _json_`
            : `'{' || '${structuresConcat.substring(2)} || '}' as _json_`
        }

        // Calculate final output columns once
        let outputColumns = ''
        outputColumns = `_new_path_ as _path_,${blobs} as _blobs_,${expands} as _expands_,${jsonColumn}`
        if (blobColumns.length)
          outputColumns = `${outputColumns},${blobColumns.map(b => `${this.quote(b)} as "${b.replace(/"/g, '""')}"`)}`
        if (this.foreignKeys?.length) {
          outputColumns += ',' + this.foreignKeys.map(c => this.column_expr({ ref: c.ref.slice(-1) }))
        }

        if (structures.length && sql.length) {
          this._outputColumns = outputColumns
          // Select all columns to be able to use the _outputColumns in the outer select
          sql = `*,${rawJsonColumn}`
        } else {
          sql = outputColumns
        }
      }
      return sql
    }

    SELECT_expand(_, sql) {
      if (this._outputColumns) {
        return `SELECT ${this._outputColumns} FROM (${sql})`
      }
      return sql
    }

    SELECT_expand_flat(q) {
      q = cds.ql.clone(q)
      const { columns, from } = q.SELECT

      let curFrom = from
      while (curFrom && !curFrom.as) {
        curFrom = from.SELECT?.from || from.args?.[0]
      }
      from.as = curFrom.as
      const alias = from.as
      const tmp = cds.ql.SELECT('*').from(alias)
      tmp.as = alias
      tmp.SELECT.from.ref[0] = ':' + tmp.SELECT.from.ref[0]

      const foreignKeys = []

      columns.map(c => {
        // Extract all expand sub selects to a flat list of queries with joins
        // Referencing the table variables to calculate everything only once
        // This is the same behavior as the current expand implementation
        // With this having the main advantage that this does not create network traffic
        // Additionally the current implementation does not fully reproduce the root query
        // Where this approach directly references the root query results
        if (c.elements) {
          const subQuery = c
          subQuery.SELECT.parent = alias
          subQuery.SELECT.property = this.column_name(c)
          subQuery.SELECT.expand = 'root'
          subQuery.SELECT.from = {
            join: 'inner',
            args: [tmp, subQuery.SELECT.from],
            on: subQuery.SELECT.where,
            as: subQuery.SELECT.from.as,
          }
          this.extractForeignKeys(subQuery.SELECT.where, alias, foreignKeys)
          subQuery.SELECT.where = undefined
          Object.defineProperty(subQuery, 'elements', { val: c.elements })
          this.SELECT(subQuery)
        }
      })
      return {
        foreignKeys,
      }
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

    INSERT_entries(q) {
      this.values = undefined
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

      // HANA Express does not process large JSON documents
      // The limit is somewhere between 64KB and 128KB
      if (HANAVERSION <= 2) {
        // Simple line splitting would be preferred, but batch execute does not work properly
        // Which makes sending every line separately much slower
        // this.entries = INSERT.entries.map(e => [JSON.stringify(e)])

        this.entries = []
        let cur = ['[']
        this.entries.push(cur)
        INSERT.entries
          .map(r => JSON.stringify(r))
          .forEach(r => {
            if (cur[0].length > 65535) {
              cur[0] += ']'
              cur = ['[']
              this.entries.push(cur)
            } else if (cur[0].length > 1) {
              cur[0] += ','
            }
            cur[0] += r
          })
        cur[0] += ']'
      } else {
        this.entries = [[JSON.stringify(INSERT.entries)]]
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
      let { UPSERT } = q,
        sql = this.INSERT({ __proto__: q, INSERT: UPSERT })

      // REVISIT: should @cds.persistence.name be considered ?
      const entity = q.target?.['@cds.persistence.name'] || this.name(q.target?.name || INSERT.into.ref[0])
      const elements = q.elements || q.target?.elements

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
        '<>': null,
        '>=': null,
        '<=': null,
        '!<': null,
        '!>': null,
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
        // Don't apply input converters for place holders
        const converter = (sql !== '?' && element[inputConverterKey]) || (e => e)
        const val = _managed[element[annotation]?.['=']]
        let managed
        if (val) managed = this.func({ func: 'session_context', args: [{ val }] })
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
      Int16: () => 'INT',
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
      // REVISIT: BASE64_DECODE has stopped working
      // Unable to convert NVARCHAR to UTF8
      // Not encoded string with CESU-8 or some UTF-8 except a surrogate pair at "base64_decode" function
      Binary: e => `CONCAT('base64,',${e})`,
      Boolean: e => `CASE WHEN ${e} = 'true' THEN TRUE WHEN ${e} = 'false' THEN FALSE END`,
    }

    static OutputConverters = {
      ...super.OutputConverters,
      // REVISIT: binaries should use BASE64_ENCODE, but this results in BASE64_ENCODE(BINTONHEX(${e}))
      Binary: e => `BINTONHEX(${e})`,
      Date: e => `to_char(${e}, 'YYYY-MM-DD')`,
      Time: e => `to_char(${e}, 'HH24:MI:SS')`,
      DateTime: e => `to_char(${e}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
      Timestamp: e => `to_char(${e}, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')`,
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

  onBEGIN() {}

  onCOMMIT() {
    DEBUG?.('COMMIT')
    return this.dbc.commit()
  }

  onROLLBACK() {
    DEBUG?.('ROLLBACK')
    return this.dbc.rollback()
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
      const res = await stmt.all([creds.user, creds.password, creds.containerGroup, !clean])
      DEBUG?.(res.map(r => r.MESSAGE).join('\n'))
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
      const res = await stmt.all([creds.user, creds.password, creds.schema, !clean])
      res && DEBUG?.(res.map(r => r.MESSAGE).join('\n'))
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
  return this.toString('base64')
}

const is_regexp = x => x?.constructor?.name === 'RegExp' // NOTE: x instanceof RegExp doesn't work in repl
const ObjectKeys = o => (o && [...ObjectKeys(o.__proto__), ...Object.keys(o)]) || []
const _managed = {
  '$user.id': '$user.id',
  $user: '$user.id',
  $now: '$now',
}

module.exports = HANAService
