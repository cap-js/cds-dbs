const cds = require('@sap/cds/lib')
const cds_infer = require('./infer')
const cqn4sql = require('./cqn4sql')

const { Readable } = require('stream')

const DEBUG = (() => {
  let DEBUG = cds.debug('sql-json')
  if (DEBUG) return DEBUG
  else DEBUG = cds.debug('sql|sqlite')
  if (DEBUG) {
    return DEBUG
    // (sql, ...more) => DEBUG (sql.replace(/(?:SELECT[\n\r\s]+(json_group_array\()?[\n\r\s]*json_insert\((\n|\r|.)*?\)[\n\r\s]*\)?[\n\r\s]+as[\n\r\s]+_json_[\n\r\s]+FROM[\n\r\s]*\(|\)[\n\r\s]*(\)[\n\r\s]+AS )|\)$)/gim,(a,b,c,d) => d || ''), ...more)
    // FIXME: looses closing ) on INSERT queries
  }
})()

class CQN2SQLRenderer {
  /**
   * Creates a new CQN2SQL instance for processing a query
   * @constructor
   * @param {import('@sap/cds/apis/services').ContextProperties} context the cds.context of the request
   */
  constructor(srv) {
    this.context = srv?.context || cds.context // Using srv.context is required due to stakeholders doing unmanaged txs without cds.context being set
    this.class = new.target // for IntelliSense
    this.class._init() // is a noop for subsequent calls
  }

  static _add_mixins (aspect, mixins) {
    const fqn = this.name + aspect
    const types = cds.builtin.types
    for (let each in mixins) {
      const def = types[each]
      if (!def) continue
      Object.defineProperty(def, fqn, { value: mixins[each] })
    }
    return fqn
  }

  /**
   * Initializes the class one first creation to link types to data converters
   */
  static _init() {
    this._localized = this._add_mixins(':localized', this.localized)
    this._convertInput = this._add_mixins(':convertInput', this.InputConverters)
    this._convertOutput = this._add_mixins(':convertOutput', this.OutputConverters)
    this._sqlType = this._add_mixins(':sqlType', this.TypeMap)
    // Have all-uppercase all-lowercase, and capitalized keywords to speed up lookups
    for (let each in this.ReservedWords) {
      // ORDER
      this.ReservedWords[each[0] + each.slice(1).toLowerCase()] = 1 // Order
      this.ReservedWords[each.toLowerCase()] = 1 // order
    }
    this._init = () => {} // makes this a noop for subsequent calls
  }

  /**
   * Renders incoming query into SQL and generates binding values
   * @param {import('./infer/cqn').Query} q CQN query to be rendered
   * @param {unknown[]|undefined} vars Values to be used for params
   * @returns {CQN2SQLRenderer|unknown}
   */
  render(q, vars) {
    const cmd = q.cmd || Object.keys(q)[0] // SELECT, INSERT, ...
    /**
     * @type {string} the rendered SQL string
     */
    this.sql = '' // to have it as first property for debugging
    /** @type {unknown[]} */
    this.values = [] // prepare values, filled in by subroutines
    this[cmd]((this.cqn = q)) // actual sql rendering happens here
    if (vars?.length && !this.values?.length) this.values = vars
    const sanitize_values = process.env.NODE_ENV === 'production' && cds.env.log.sanitize_values !== false
    DEBUG?.(
      this.sql,
      sanitize_values && (this.entries || this.values?.length > 0) ? ['***'] : this.entries || this.values,
    )
    return this
  }

  /**
   * Links the incoming query with the current service model
   * @param {import('./infer/cqn').Query} q
   * @returns {import('./infer/cqn').Query}
   */
  infer(q) {
    return q.target ? q : cds_infer(q)
  }

  // CREATE Statements ------------------------------------------------

  /**
   * Renders a CREATE query into generic SQL
   * @param {import('./infer/cqn').CREATE} q
   */
  CREATE(q) {
    const { target } = q,
      { query } = target
    const name = this.name(target.name)
    // Don't allow place holders inside views
    delete this.values
    this.sql =
      !query || target['@cds.persistence.table']
        ? `CREATE TABLE ${name} ( ${this.CREATE_elements(target.elements)} )`
        : `CREATE VIEW ${name} AS ${this.SELECT(cqn4sql(query))}`
    this.values = []
    return
  }

  /**
   * Renders a column clause for the given elements
   * @param {import('./infer/cqn').elements} elements
   * @returns {string} SQL
   */
  CREATE_elements(elements) {
    let sql = ''
    for (let e in elements) {
      const definition = elements[e]
      if (definition.isAssociation) continue
      const s = this.CREATE_element(definition)
      if (s) sql += `${s}, `
    }
    return sql.slice(0, -2)
  }

  /**
   * Renders a column definition for the given element
   * @param {import('./infer/cqn').element} element
   * @returns {string} SQL
   */
  CREATE_element(element) {
    const type = this.type4(element)
    if (type) return this.quote(element.name) + ' ' + type
  }

  /**
   * Renders the SQL type definition for the given element
   * @param {import('./infer/cqn').element} element
   * @returns {string}
   */
  type4(element) {
    if (!element._type) element = cds.builtin.types[element.type] || element
    const fn = element[this.class._sqlType]
    return (
      fn?.(element) || element._type?.replace('cds.', '').toUpperCase() || cds.error`Unsupported type: ${element.type}`
    )
  }

  /** @callback converter */

  /** @type {Object<string,import('@sap/cds/apis/csn').Definition>} */
  static TypeMap = {
    // Utilizing cds.linked inheritance
    String: e => `NVARCHAR(${e.length || 5000})`,
    Binary: e => `VARBINARY(${e.length || 5000})`,
    Int64: () => 'BIGINT',
    Int32: () => 'INTEGER',
    Int16: () => 'SMALLINT',
    UInt8: () => 'SMALLINT',
    Integer64: () => 'BIGINT',
    LargeString: () => 'NCLOB',
    LargeBinary: () => 'BLOB',
    Association: () => false,
    Composition: () => false,
    array: () => 'NCLOB',
    // HANA types
    /* Disabled as these types are linked to normal cds types
    'cds.hana.TINYINT': () => 'REAL',
    'cds.hana.REAL': () => 'REAL',
    'cds.hana.CHAR': e => `CHAR(${e.length || 1})`,
    'cds.hana.ST_POINT': () => 'ST_POINT',
    'cds.hana.ST_GEOMETRY': () => 'ST_GEO',*/
  }

  // DROP Statements ------------------------------------------------

  /**
   * Renders a DROP query into generic SQL
   * @param {import('./infer/cqn').DROP} q
   */
  DROP(q) {
    const { target } = q
    const isView = target.query || target.projection
    return (this.sql = `DROP ${isView ? 'VIEW' : 'TABLE'} IF EXISTS ${this.name(target.name)}`)
  }

  // SELECT Statements ------------------------------------------------

  /**
   * Renders a SELECT statement into generic SQL
   * @param {import('./infer/cqn').SELECT} q
   */
  SELECT(q) {
    let { from, expand, where, groupBy, having, orderBy, limit, one, distinct, localized } = q.SELECT
    // REVISIT: When selecting from an entity that is not in the model the from.where are not normalized (as cqn4sql is skipped)
    if (!where && from?.ref?.length === 1 && from.ref[0]?.where) where = from.ref[0]?.where
    let columns = this.SELECT_columns(q)
    let sql = `SELECT`
    if (distinct) sql += ` DISTINCT`
    if (!_empty(columns)) sql += ` ${columns}`
    if (!_empty(from)) sql += ` FROM ${this.from(from)}`
    if (!_empty(where)) sql += ` WHERE ${this.where(where)}`
    if (!_empty(groupBy)) sql += ` GROUP BY ${this.groupBy(groupBy)}`
    if (!_empty(having)) sql += ` HAVING ${this.having(having)}`
    if (!_empty(orderBy)) sql += ` ORDER BY ${this.orderBy(orderBy, localized)}`
    if (one) limit = Object.assign({}, limit, { rows: { val: 1 } })
    if (limit) sql += ` LIMIT ${this.limit(limit)}`
    // Expand cannot work without an inferred query
    if (expand) {
      // REVISIT: Why don't we handle that as an error in SELECT_expand?
      if (!q.elements) cds.error`Query was not inferred and includes expand. For which the metadata is missing.`
      sql = this.SELECT_expand(q, sql)
    }
    return (this.sql = sql)
  }

  /**
   * Renders a column clause into generic SQL
   * @param {import('./infer/cqn').SELECT} param0
   * @returns {string} SQL
   */
  SELECT_columns(q) {
    return (q.SELECT.columns ?? ['*']).map(x => this.column_expr(x, q))
  }

  /**
   * Renders a JSON select around the provided SQL statement
   * @param {import('./infer/cqn').SELECT} param0
   * @param {string} sql
   * @returns {string} SQL
   */
  SELECT_expand({ SELECT, elements }, sql) {
    if (!SELECT.columns) return sql
    if (!elements) return sql // REVISIT: Above we say this is an error condition, but here we say it's ok?
    
    let cols = SELECT.columns.map(x => {
      const name = this.column_name(x)
      let col = `'${name}',${this.output_converter4(x.element, this.quote(name))}`
      if (x.SELECT?.count) {
        // Return both the sub select and the count for @odata.count
        const qc = cds.ql.clone(x, { columns: [{ func: 'count' }], one: 1, limit: 0, orderBy: 0 })
        return [col, `'${name}@odata.count',${this.expr(qc)}`]
      }
      return col
    }).flat()

    // Prevent SQLite from hitting function argument limit of 100
    let obj = ''

    if(cols.length < 50) obj =  `json_object(${cols.slice(0, 50)})`
    else {
      const chunks = []
      for (let i = 0; i < cols.length; i += 50) {
        chunks.push(`json_object(${cols.slice(i, i + 50)})`)
      }
      // REVISIT: json_merge is a user defined function, bad performance!
      obj = `json_merge(${chunks})`
    } 


    return `SELECT ${SELECT.one || SELECT.expand === 'root' ? obj : `json_group_array(${obj.includes('json_merge') ? `json_insert(${obj})` : obj})`} as _json_ FROM (${sql})`
  }

  /**
   * Renders a SELECT column expression into generic SQL
   * @param {import('./infer/cqn').col} x
   * @returns {string} SQL
   */
  column_expr(x, q) {
    if (x === '*') return '*'
    ///////////////////////////////////////////////////////////////////////////////////////
    // REVISIT: that should move out of here!
    if (x?.element?.['@cds.extension']) {
      return `extensions__->${this.string('$."' + x.element.name + '"')} as ${x.as || x.element.name}`
    }
    ///////////////////////////////////////////////////////////////////////////////////////
    let sql = this.expr(x)
    let alias = this.column_alias4(x, q)
    if (alias) sql += ' as ' + this.quote(alias)
    return sql
  }

  /**
   * Extracts the column alias from a SELECT column expression
   * @param {import('./infer/cqn').col} x
   * @returns {string}
   */
  column_alias4(x) {
    return typeof x.as === 'string' ? x.as : x.func
  }

  /**
   * Renders a FROM clause into generic SQL
   * @param {import('./infer/cqn').source} from
   * @returns {string} SQL
   */
  from(from) {
    const { ref, as } = from
    const _aliased = as ? s => s + ` as ${this.quote(as)}` : s => s
    if (ref) return _aliased(this.quote(this.name(ref[0])))
    if (from.SELECT) return _aliased(`(${this.SELECT(from)})`)
    if (from.join)
      return `${this.from(from.args[0])} ${from.join} JOIN ${this.from(from.args[1])} ON ${this.where(from.on)}`
  }

  /**
   * Renders a WHERE clause into generic SQL
   * @param {import('./infer/cqn').predicate} xpr
   * @returns {string} SQL
   */
  where(xpr) {
    return this.xpr({ xpr })
  }

  /**
   * Renders a HAVING clause into generic SQL
   * @param {import('./infer/cqn').predicate} xpr
   * @returns {string} SQL
   */
  having(xpr) {
    return this.xpr({ xpr })
  }

  /**
   * Renders a groupBy clause into generic SQL
   * @param {import('./infer/cqn').expr[]} clause
   * @returns {string[] | string} SQL
   */
  groupBy(clause) {
    return clause.map(c => this.expr(c))
  }

  /**
   * Renders an orderBy clause into generic SQL
   * @param {import('./infer/cqn').ordering_term[]} orderBy
   * @param {boolean | undefined} localized
   * @returns {string[] | string} SQL
   */
  orderBy(orderBy, localized) {
    return orderBy.map(
      localized
        ? c =>
            this.expr(c) +
            (c.element?.[this.class._localized] ? ' COLLATE NOCASE' : '') +
            (c.sort === 'desc' || c.sort === -1 ? ' DESC' : ' ASC')
        : c => this.expr(c) + (c.sort === 'desc' || c.sort === -1 ? ' DESC' : ' ASC'),
    )
  }

  /**
   * Renders an limit clause into generic SQL
   * @param {import('./infer/cqn').limit} param0
   * @returns {string} SQL
   * @throws {Error} When no rows are defined
   */
  limit({ rows, offset }) {
    if (!rows) throw new Error('Rows parameter is missing in SELECT.limit(rows, offset)')
    return !offset ? rows.val : `${rows.val} OFFSET ${offset.val}`
  }

  // INSERT Statements ------------------------------------------------

  /**
   * Renders an INSERT query into generic SQL
   * @param {import('./infer/cqn').INSERT} q
   * @returns {string} SQL
   */
  INSERT(q) {
    const { INSERT } = q
    return INSERT.entries
      ? this.INSERT_entries(q)
      : INSERT.rows
      ? this.INSERT_rows(q)
      : INSERT.values
      ? this.INSERT_values(q)
      : INSERT.as
      ? this.INSERT_select(q)
      : cds.error`Missing .entries, .rows, or .values in ${q}`
  }

  /**
   * Renders an INSERT query with entries property
   * @param {import('./infer/cqn').INSERT} q
   * @returns {string} SQL
   */
  INSERT_entries(q) {
    const { INSERT } = q
    const entity = this.name(q.target?.name || INSERT.into.ref[0])
    const alias = INSERT.into.as
    const elements = q.elements || q.target?.elements
    if (!elements && !INSERT.entries?.length) {
      return // REVISIT: mtx sends an insert statement without entries and no reference entity
    }
    const columns = elements
      ? ObjectKeys(elements).filter(c => c in elements && !elements[c].virtual && !elements[c].isAssociation)
      : ObjectKeys(INSERT.entries[0])

    /** @type {string[]} */
    this.columns = columns.filter(elements ? c => !elements[c]?.['@cds.extension'] : () => true).map(c => this.quote(c))

    const extractions = this.managed(
      columns.map(c => ({ name: c })),
      elements,
      !!q.UPSERT,
    )
    const extraction = extractions
      .map(c => {
        const element = elements?.[c.name]
        if (element?.['@cds.extension']) {
          return false
        }
        if (c.name === 'extensions__') {
          const merges = extractions.filter(c => elements?.[c.name]?.['@cds.extension'])
          if (merges.length) {
            c.sql = `json_set(ifnull(${c.sql},'{}'),${merges.map(
              c => this.string('$."' + c.name + '"') + ',' + c.sql,
            )})`
          }
        }
        return c
      })
      .filter(a => a)
      .map(c => c.sql)

    // Include this.values for placeholders
    /** @type {unknown[][]} */
    this.entries = [[...this.values, JSON.stringify(INSERT.entries)]]
    return (this.sql = `INSERT INTO ${this.quote(entity)}${alias ? ' as ' + this.quote(alias) : ''} (${
      this.columns
    }) SELECT ${extraction} FROM json_each(?)`)
  }

  /**
   * Renders an INSERT query with rows property
   * @param {import('./infer/cqn').INSERT} q
   * @returns {string} SQL
   */
  INSERT_rows(q) {
    const { INSERT } = q
    const entity = this.name(q.target?.name || INSERT.into.ref[0])
    const alias = INSERT.into.as
    const elements = q.elements || q.target?.elements
    const columns = INSERT.columns
    || cds.error`Cannot insert rows without columns or elements`

    const inputConverter = this.class._convertInput
    const extraction = columns.map((c,i) => {
      const extract = `value->>'$[${i}]'`
      const element = elements?.[c]
      const converter = element?.[inputConverter]
      return converter?.(extract,element) || extract
    })

    this.columns = columns.map(c => this.quote(c))
    this.entries = [[JSON.stringify(INSERT.rows)]]
    return (this.sql = `INSERT INTO ${this.quote(entity)}${alias ? ' as ' + this.quote(alias) : ''} (${
      this.columns
    }) SELECT ${extraction} FROM json_each(?)`)
  }

  /**
   * Renders an INSERT query with values property
   * @param {import('./infer/cqn').INSERT} q
   * @returns {string} SQL
   */
  INSERT_values(q) {
    let { columns, values } = q.INSERT
    return this.INSERT_rows({ __proto__: q, INSERT: { __proto__: q.INSERT, columns, rows: [values] } })
  }

  /**
   * Renders an INSERT query from SELECT query
   * @param {import('./infer/cqn').INSERT} q
   * @returns {string} SQL
   */
  INSERT_select(q) {
    const { INSERT } = q
    const entity = this.name(q.target.name)
    const alias = INSERT.into.as
    const elements = q.elements || q.target?.elements || {}
    const columns = (this.columns = (INSERT.columns || ObjectKeys(elements)).filter(
      c => c in elements && !elements[c].virtual && !elements[c].isAssociation,
    ))
    this.sql = `INSERT INTO ${entity}${alias ? ' as ' + this.quote(alias) : ''} (${columns}) ${this.SELECT(
      cqn4sql(INSERT.as),
    )}`
    this.entries = [this.values]
    return this.sql
  }

  /**
   * Wraps the provided SQL expression for output processing
   * @param {import('./infer/cqn').element} element
   * @param {string} expr
   * @returns {string} SQL
   */
  output_converter4(element, expr) {
    const fn = element?.[this.class._convertOutput]
    return fn?.(expr, element) || expr
  }

  /** @type {import('./converters').Converters} */
  static InputConverters = {} // subclasses to override

  /** @type {import('./converters').Converters} */
  static OutputConverters = {} // subclasses to override

  static localized = { String: true, UUID: false }

  // UPSERT Statements ------------------------------------------------

  /**
   * Renders an UPSERT query into generic SQL
   * @param {import('./infer/cqn').UPDATE} q
   * @returns {string} SQL
   */
  UPSERT(q) {
    let { UPSERT } = q,
      sql = this.INSERT({ __proto__: q, INSERT: UPSERT })
    let keys = q.target?.keys
    if (!keys) return (this.sql = sql) // REVISIT: We should converge q.target and q._target
    keys = Object.keys(keys).filter(k => !keys[k].isAssociation)

    let updateColumns = q.UPSERT.entries ? Object.keys(q.UPSERT.entries[0]) : this.columns
    updateColumns = updateColumns
      .filter(c => !keys.includes(c))
      .map(c => `${this.quote(c)} = excluded.${this.quote(c)}`)

    // temporal data
    keys.push(...Object.values(q.target.elements).filter(e => e['@cds.valid.from']).map(e => e.name))

    keys = keys.map(k => this.quote(k))
    const conflict = updateColumns.length
      ? `ON CONFLICT(${keys}) DO UPDATE SET ` + updateColumns
      : `ON CONFLICT(${keys}) DO NOTHING`
    return (this.sql = `${sql} WHERE true ${conflict}`)
  }

  // UPDATE Statements ------------------------------------------------

  /**
   * Renders an UPDATE query into generic SQL
   * @param {import('./infer/cqn').UPDATE} q
   * @returns {string} SQL
   */
  UPDATE(q) {
    const { entity, with: _with, data, where } = q.UPDATE
    const elements = q.target?.elements
    let sql = `UPDATE ${this.name(entity.ref?.[0] || entity)}`
    if (entity.as) sql += ` AS ${entity.as}`

    let columns = []
    if (data) _add (data, val => this.val({val}))
    if (_with) _add (_with, x => this.expr(x))
    function _add (data, sql4) {
      for (let c in data) {
        if (!elements || (c in elements && !elements[c].virtual)) {
          columns.push({ name: c, sql: sql4(data[c]) })
        }
      }
    }

    columns = columns.map(c => {
      if (q.elements?.[c.name]?.['@cds.extension']) return {
        name: 'extensions__',
        sql: `json_set(extensions__,${this.string('$."' + c.name + '"')},${c.sql})`,
      }
      return c
    })

    const extraction = this.managed(columns, elements, true).map(c => `${this.quote(c.name)}=${c.sql}`)

    sql += ` SET ${extraction}`
    if (where) sql += ` WHERE ${this.where(where)}`
    return (this.sql = sql)
  }

  // DELETE Statements ------------------------------------------------

  /**
   * Renders a DELETE query into generic SQL
   * @param {import('./infer/cqn').DELETE} param0
   * @returns {string} SQL
   */
  DELETE({ DELETE: { from, where } }) {
    let sql = `DELETE FROM ${this.from(from)}`
    if (where) sql += ` WHERE ${this.where(where)}`
    return (this.sql = sql)
  }

  // STREAM Statement -------------------------------------------------

  /**
   * Renders a STREAM query into generic SQL
   * @param {import('./infer/cqn').STREAM} q
   * @returns {string} SQL
   */
  STREAM(q) {
    const { STREAM } = q
    return STREAM.from
      ? this.STREAM_from(q)
      : STREAM.into
      ? this.STREAM_into(q)
      : cds.error`Missing .form or .into in ${q}`
  }

  /**
   * Renders a STREAM.into query into generic SQL
   * @param {import('./infer/cqn').STREAM} q
   * @returns {string} SQL
   */
  STREAM_into(q) {
    const { into, column, where, data } = q.STREAM

    let sql
    if (!_empty(column)) {
      data.type = 'binary'
      const update = UPDATE(into)
        .with({ [column]: data })
        .where(where)
      Object.defineProperty(update, 'target', { value: q.target })
      sql = this.UPDATE(update)
    } else {
      data.type = 'json'
      // REVISIT: decide whether dataset streams should behave like INSERT or UPSERT
      sql = this.UPSERT(UPSERT([{}]).into(into).forSQL())
      this.values = [data]
    }

    return (this.sql = sql)
  }

  /**
   * Renders a STREAM.from query into generic SQL
   * @param {import('./infer/cqn').STREAM} q
   * @returns {string} SQL
   */
  STREAM_from(q) {
    const { column, from, where, columns } = q.STREAM

    const select = cds.ql
      .SELECT(column ? [column] : columns)
      .where(where)
      .limit(column ? 1 : undefined)

    // SELECT.from() does not accept joins
    select.SELECT.from = from

    if (column) {
      this.one = true
    } else {
      select.SELECT.expand = 'root'
      this.one = !!from.SELECT?.one
    }
    return this.SELECT(select.forSQL())
  }

  // Expression Clauses ---------------------------------------------

  /**
   * Renders an expression object into generic SQL
   * @param {import('./infer/cqn').expr} x
   * @returns {string} SQL
   * @throws {Error} When an unknown un supported expression is provided
   */
  expr(x) {
    const wrap = x.cast ? sql => `cast(${sql} as ${this.type4(x.cast)})` : sql => sql
    if (typeof x === 'string') throw cds.error`Unsupported expr: ${x}`
    if ('param' in x) return wrap(this.param(x))
    if ('ref' in x) return wrap(this.ref(x))
    if ('val' in x) return wrap(this.val(x))
    if ('xpr' in x) return wrap(this.xpr(x))
    if ('func' in x) return wrap(this.func(x))
    if ('list' in x) return wrap(this.list(x))
    if ('SELECT' in x) return wrap(`(${this.SELECT(x)})`)
    else throw cds.error`Unsupported expr: ${x}`
  }

  /**
   * Renders an list of expression objects into generic SQL
   * @param {import('./infer/cqn').xpr} param0
   * @returns {string} SQL
   */
  xpr({ xpr }) {
    return xpr
      .map((x, i) => {
        if (x in { LIKE: 1, like: 1 } && is_regexp(xpr[i + 1]?.val)) return this.operator('regexp')
        if (typeof x === 'string') return this.operator(x, i, xpr)
        if (x.xpr) return `(${this.xpr(x)})`
        else return this.expr(x)
      })
      .join(' ')
  }

  /**
   * Renders an operation into generic SQL
   * @param {string} x The current operator string
   * @param {Number} i Current index of the operator inside the xpr
   * @param {import('./infer/cqn').predicate[]} xpr The parent xpr in which the operator is used
   * @returns {string} The correct operator string
   */
  operator(x, i, xpr) {

    // Translate = to IS NULL for rhs operand being NULL literal
    if (x === '=')  return xpr[i+1]?.val === null ? 'is' : '='

    // Translate == to IS NOT NULL for rhs operand being NULL literal, otherwise ...
    // Translate == to IS NOT DISTINCT FROM, unless both operands cannot be NULL
    if (x === '==') return xpr[i+1]?.val === null ? 'is' : _not_null(i-1) && _not_null(i+1) ? '=' : this.is_not_distinct_from_

    // Translate != to IS NULL for rhs operand being NULL literal, otherwise...
    // Translate != to IS DISTINCT FROM, unless both operands cannot be NULL
    if (x === '!=') return xpr[i+1]?.val === null ? 'is not' : _not_null(i-1) && _not_null(i+1) ? '<>' : this.is_distinct_from_

    else return x

    /** Checks if the operand at xpr[i+-1] can be NULL. @returns true if not */
    function _not_null(i) {
      const operand = xpr[i]
      if (!operand) return false
      if (operand.val != null) return true // non-null values are not null
      let element = operand.element
      if (!element) return false
      if (element.key) return true // primary keys usually should not be null
      if (element.notNull) return true // not null elements cannot be null
    }
  }

  get is_distinct_from_() { return 'is distinct from' }
  get is_not_distinct_from_() { return 'is not distinct from' }

  /**
   * Renders an argument place holder into the SQL for prepared statements
   * @param {import('./infer/cqn').ref} param0
   * @returns {string} SQL
   * @throws {Error} When an unsupported ref definition is provided
   */
  param({ ref }) {
    if (ref.length > 1) throw cds.error`Unsupported nested ref parameter: ${ref}`
    return ref[0] === '?' ? '?' : `:${ref}`
  }

  /**
   * Renders a ref into generic SQL
   * @param {import('./infer/cqn').ref} param0
   * @returns {string} SQL
   */
  ref({ ref }) {
    switch (ref[0]) {
      case '$now': return this.func({ func: 'session_context', args: [{ val: '$now' }]})
      case '$user':
      case '$user.id': return this.func({ func: 'session_context', args: [{ val: '$user.id' }]})
      default: return ref.map(r => this.quote(r)).join('.')
    }
  }

  /**
   * Renders a value into the correct SQL syntax of a placeholder for a prepared statement
   * @param {import('./infer/cqn').val} param0
   * @returns {string} SQL
   */
  val({ val }) {
    switch (typeof val) {
      case 'function': throw new Error('Function values not supported.')
      case 'undefined': return 'NULL'
      case 'boolean': return `${val}`
      case 'number': return `${val}` // REVISIT for HANA
      case 'object':
        if (val === null) return 'NULL'
        if (val instanceof Date) return `'${val.toISOString()}'`
        if (val instanceof Readable) ; // go on with default below
        else if (Buffer.isBuffer(val)) val = val.toString('base64')
        else if (is_regexp(val)) val = val.source
        else val = JSON.stringify(val)
      case 'string': // eslint-disable-line no-fallthrough
    }
    if (!this.values) return this.string(val)
    else this.values.push(val)
    return '?'
  }

  static Functions = require('./cql-functions')
  /**
   * Renders a function call into mapped SQL definitions from the Functions definition
   * @param {import('./infer/cqn').func} param0
   * @returns {string} SQL
   */
  func({ func, args }) {
    args = (args || []).map(e => (e === '*' ? e : { __proto__: e, toString: (x = e) => this.expr(x) }))
    return this.class.Functions[func]?.apply(this.class.Functions, args) || `${func}(${args})`
  }

  /**
   * Renders a list into generic SQL
   * @param {import('./infer/cqn').list} param0
   * @returns {string} SQL
   */
  list({ list }) {
    return `(${list.map(e => this.expr(e))})`
  }

  /**
   * Renders a javascript string into a SQL string literal
   * @param {string} s
   * @returns {string} SQL
   */
  string(s) {
    return `'${s.replace(/'/g, "''")}'`
  }

  /**
   * Calculates the effect column name
   * @param {import('./infer/cqn').col} col
   * @returns {string} explicit/implicit column alias
   */
  column_name(col) {
    if (col === '*')
      // REVISIT: When could this ever happen? I think this is only about that irrealistic test whech uses column_name to implement SELECT_columns. We should eliminate column_name as its only used and designed for use in SELECT_expand, isn't it?
      cds.error`Query was not inferred and includes '*' in the columns. For which there is no column name available.`
    return (typeof col.as === 'string' && col.as) || ('val' in col && col.val + '') || col.func || col.ref.at(-1)
  }

  /**
   * Calculates the Database name of the given name
   * @param {string|import('./infer/cqn').ref} name
   * @returns {string} Database name
   */
  name(name) {
    return (name.id || name).replace(/\./g, '_')
  }

  /** @type {unknown} */
  static ReservedWords = {}
  /**
   * Ensures that the given identifier is properly quoted when required by the database
   * @param {string} s
   * @returns {string} SQL
   */
  quote(s) {
    if (typeof s !== 'string') return '"' + s + '"'
    if (s.includes('"')) return '"' + s.replace(/"/g, '""') + '"'
    // Column names like "Order" clash with "ORDER" keyword so toUpperCase is required
    if (s in this.class.ReservedWords || /^\d|[$' ?@./\\]/.test(s)) return '"' + s + '"'
    return s
  }

  /**
   * Convers the columns array into an array of SQL expressions that extract the correct value from inserted JSON data
   * @param {object[]} columns
   * @param {import('./infer/cqn').elements} elements
   * @param {Boolean} isUpdate
   * @returns {string[]} Array of SQL expressions for processing input JSON data
   */
  managed(columns, elements, isUpdate = false) {
    const annotation = isUpdate ? '@cds.on.update' : '@cds.on.insert'
    const { _convertInput } = this.class
    // Ensure that missing managed columns are added
    const requiredColumns = !elements
      ? []
      : Object.keys(elements)
          .filter(
            e =>
              (elements[e]?.[annotation] || (!isUpdate && elements[e]?.default && !elements[e].virtual && !elements[e].isAssociation)) &&
              !columns.find(c => c.name === e),
          )
          .map(name => ({ name, sql: 'NULL' }))

    return [...columns, ...requiredColumns].map(({ name, sql }) => {
      let element = elements?.[name] || {}
      if (!sql) sql = `value->>'$."${name}"'`

      let converter = element[_convertInput]
      if (converter && sql[0] !== '$') sql = converter(sql, element)

      let val = _managed[element[annotation]?.['=']]
      if (val) sql = `coalesce(${sql}, ${this.func({ func: 'session_context', args: [{ val }] })})`
      else if (!isUpdate && element.default) {
        const d = element.default
        if (d.val !== undefined || d.ref?.[0] === '$now') {
          // REVISIT: d.ref is not used afterwards
          sql = `(CASE WHEN json_type(value,'$."${name}"') IS NULL THEN ${
            this.defaultValue(d.val) // REVISIT: this.defaultValue is a strange function
          } ELSE ${sql} END)`
        }
      }

      return { name, sql }
    })
  }

  /**
   * Returns the default value
   * @param {string} defaultValue
   * @returns {string}
   */
  // REVISIT: This is a strange method, also overridden inconsistently in postgres
  defaultValue(defaultValue = this.context.timestamp.toISOString()) {
    return typeof defaultValue === 'string' ? this.string(defaultValue) : defaultValue
  }
}

// REVISIT: Workaround for JSON.stringify to work with buffers
Buffer.prototype.toJSON = function () {
  return this.toString('base64')
}

const ObjectKeys = o => (o && [...ObjectKeys(o.__proto__), ...Object.keys(o)]) || []
const _managed = {
  '$user.id': '$user.id',
  $user: '$user.id',
  $now: '$now',
}

const is_regexp = x => x?.constructor?.name === 'RegExp' // NOTE: x instanceof RegExp doesn't work in repl
const _empty = a => !a || a.length === 0

/**
 * @param {import('@sap/cds/apis/cqn').Query} q
 * @param {import('@sap/cds/apis/csn').CSN} m
 */
module.exports = (q, m) => new CQN2SQLRenderer().render(cqn4sql(q, m), m)
module.exports.class = CQN2SQLRenderer
module.exports.classDefinition = CQN2SQLRenderer // class is a reserved typescript word
