const cds = require('@sap/cds')
const cds_infer = require('./infer')
const cqn4sql = require('./cqn4sql')
const _simple_queries = cds.env.features.sql_simple_queries
const _strict_booleans = _simple_queries < 2

const { Readable } = require('stream')

const DEBUG = cds.debug('sql|sqlite')
const LOG_SQL = cds.log('sql')
const LOG_SQLITE = cds.log('sqlite')

class CQN2SQLRenderer {
  /**
   * Creates a new CQN2SQL instance for processing a query
   * @constructor
   * @param {import('@sap/cds/apis/services').ContextProperties} context the cds.context of the request
   */
  constructor(srv) {
    this.srv = srv
    this.context = srv?.context || cds.context // Using srv.context is required due to stakeholders doing unmanaged txs without cds.context being set
    this.class = new.target // for IntelliSense
    this.class._init() // is a noop for subsequent calls
    this.model = srv?.model
    // Overwrite smart quoting
    if (cds.env.sql.names === 'quoted') {
      this.class.prototype.name = (name, query) => {
        const e = name.id || name
        return (query?._target || this.model?.definitions[e])?.['@cds.persistence.name'] || e
      }
      this.class.prototype.quote = (s) => `"${String(s).replace(/"/g, '""')}"`
    }
  }

  BINARY_TYPES = {
    'cds.Binary': 1,
    'cds.LargeBinary': 1,
    'cds.hana.BINARY': 1,
  }

  static _add_mixins(aspect, mixins) {
    const fqn = this.name + aspect
    const types = cds.builtin.types
    for (let each in mixins) {
      const def = types[each]
      if (!def) continue
      const value = mixins[each]
      if (value?.get) Object.defineProperty(def, fqn, { get: value.get })
      else Object.defineProperty(def, fqn, { value })
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
    this._init = () => { } // makes this a noop for subsequent calls
  }

  /**
   * Renders incoming query into SQL and generates binding values
   * @param {import('./infer/cqn').Query} q CQN query to be rendered
   * @param {unknown[]|undefined} vars Values to be used for params
   * @returns {CQN2SQLRenderer|unknown}
   */
  render(q, vars) {
    const kind = q.kind || Object.keys(q)[0] // SELECT, INSERT, ...
    /**
     * @type {string} the rendered SQL string
     */
    this.sql = '' // to have it as first property for debugging
    /** @type {unknown[]} */
    this.values = [] // prepare values, filled in by subroutines
    this[kind]((this.cqn = q)) // actual sql rendering happens here
    if (this._with?.length) {
      this.render_with()
    }
    if (vars?.length && !this.values?.length) this.values = vars
    if (vars && Object.keys(vars).length && !this.values?.length) this.values = vars
    const sanitize_values = process.env.NODE_ENV === 'production' && cds.env.log.sanitize_values !== false


    if (DEBUG && (LOG_SQL._debug || LOG_SQLITE._debug)) {
      let values = sanitize_values && (this.entries || this.values?.length > 0) ? ['***'] : this.entries || this.values || []
      if (values && !Array.isArray(values)) {
        values = [values]
      }
      DEBUG(this.sql, values)
    }

    return this
  }

  render_with() {
    const sql = this.sql
    let recursive = false
    const values = this.values
    const prefix = this._with.map(q => {
      const values = this.values = []
      let sql
      if ('SELECT' in q) sql = `${this.quote(q.as)} AS (${this.SELECT(q)})`
      else if ('SET' in q) {
        recursive = true
        const { SET } = q
        sql = `${this.quote(q.as)}(${SET.args[0].SELECT.columns?.map(c => this.quote(this.column_name(c))) || ''}) AS (${this.SELECT(SET.args[0])} ${SET.op?.toUpperCase() || 'UNION'} ${SET.all ? 'ALL' : ''} ${this.SELECT(SET.args[1])}${SET.orderBy ? ` ORDER BY ${this.orderBy(SET.orderBy)}` : ''})`
      }
      return { sql, values }
    })
    this.sql = `WITH${recursive ? ' RECURSIVE' : ''} ${prefix.map(p => p.sql)} ${sql}`
    this.values = [...prefix.map(p => p.values).flat(), ...values]
  }

  /**
   * Links the incoming query with the current service model
   * @param {import('./infer/cqn').Query} q
   * @returns {import('./infer/cqn').Query}
   */
  infer(q) {
    return q._target instanceof cds.entity ? q : cds_infer(q)
  }

  cqn4sql(q) {
    return cqn4sql(q, this.model)
  }

  // CREATE Statements ------------------------------------------------

  /**
   * Renders a CREATE query into generic SQL
   * @param {import('./infer/cqn').CREATE} q
   */
  CREATE(q) {
    let { _target: target } = q
    let query = target?.query || q.CREATE.as
    if (!target || target._unresolved) {
      const entity = q.CREATE.entity
      target = typeof entity === 'string' ? { name: entity } : q.CREATE.entity
    }

    const name = this.name(target.name, q)
    // Don't allow place holders inside views
    delete this.values
    this.sql =
      !query || target['@cds.persistence.table']
        ? `CREATE TABLE ${this.quote(name)} ( ${this.CREATE_elements(target.elements)} )`
        : `CREATE VIEW ${this.quote(name)} AS ${this.SELECT(this.cqn4sql(query))}`
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
    let keys = ''
    for (let e in elements) {
      const definition = elements[e]
      if (definition.isAssociation) continue
      if (definition.key) keys = `${keys}, ${this.quote(definition.name)}`
      const s = this.CREATE_element(definition)
      if (s) sql += `, ${s}`
    }
    return `${sql.slice(2)}${keys && `, PRIMARY KEY(${keys.slice(2)})`}`
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
    UUID: () => `NVARCHAR(36)`,
    String: e => `NVARCHAR(${e.length || 5000})`,
    Binary: e => `VARBINARY(${e.length || 5000})`,
    UInt8: () => 'TINYINT',
    Int16: () => 'SMALLINT',
    Int32: () => 'INT',
    Int64: () => 'BIGINT',
    Integer: () => 'INT',
    Integer64: () => 'BIGINT',
    LargeString: () => 'NCLOB',
    LargeBinary: () => 'BLOB',
    Association: () => false,
    Composition: () => false,
    array: () => 'NCLOB',
    Map: () => 'NCLOB',
    // HANA types
    'cds.hana.TINYINT': () => 'TINYINT',
    'cds.hana.REAL': () => 'REAL',
    'cds.hana.CHAR': e => `CHAR(${e.length || 1})`,
    'cds.hana.ST_POINT': () => 'ST_POINT',
    'cds.hana.ST_GEOMETRY': () => 'ST_GEOMETRY',
  }

  // DROP Statements ------------------------------------------------

  /**
   * Renders a DROP query into generic SQL
   * @param {import('./infer/cqn').DROP} q
   */
  DROP(q) {
    const { _target: target } = q
    const isView = target?.query || target?.projection || q.DROP.view
    const name = target?.name || q.DROP.table?.ref?.[0] || q.DROP.view?.ref?.[0]
    return (this.sql = `DROP ${isView ? 'VIEW' : 'TABLE'} IF EXISTS ${this.quote(this.name(name, q))}`)
  }

  // SELECT Statements ------------------------------------------------

  /**
   * Renders a SELECT statement into generic SQL
   * @param {import('./infer/cqn').SELECT} q
   */
  SELECT(q) {
    let { from, expand, where, groupBy, having, orderBy, limit, one, distinct, localized, forUpdate, forShareLock, recurse } =
      q.SELECT

    if (from?.join && !q.SELECT.columns) {
      throw new Error('CQN query using joins must specify the selected columns.')
    }

    // REVISIT: When selecting from an entity that is not in the model the from.where are not normalized (as cqn4sql is skipped)
    if (!where && from?.ref?.length === 1 && from.ref[0]?.where) where = from.ref[0]?.where
    const columns = this.SELECT_columns(q)
    let sql = `SELECT`
    if (distinct) sql += ` DISTINCT`
    if (!_empty(columns)) sql += ` ${columns}`
    if (recurse) sql += ` FROM ${this.SELECT_recurse(q)}`
    else if (!_empty(from)) sql += ` FROM ${this.from(from, q)}`
    else sql += this.from_dummy()
    if (!recurse && !_empty(where)) sql += ` WHERE ${this.where(where)}`
    if (!recurse && !_empty(groupBy)) sql += ` GROUP BY ${this.groupBy(groupBy)}`
    if (!recurse && !_empty(having)) sql += ` HAVING ${this.having(having)}`
    if (!recurse && !_empty(orderBy)) sql += ` ORDER BY ${this.orderBy(orderBy, localized)}`
    if (one) limit = Object.assign({}, limit, { rows: { val: 1 } })
    if (limit) sql += ` LIMIT ${this.limit(limit)}`
    if (forUpdate) sql += ` ${this.forUpdate(forUpdate)}`
    else if (forShareLock) sql += ` ${this.forShareLock(forShareLock)}`
    // Expand cannot work without an inferred query
    if (expand) {
      if ('elements' in q) sql = this.SELECT_expand(q, sql)
      else cds.error`Query was not inferred and includes expand. For which the metadata is missing.`
    }
    return (this.sql = sql)
  }

  SELECT_recurse(q) {
    let { from, columns, where, orderBy, recurse, _internal } = q.SELECT

    const _target = q._target

    if (_target && where) {
      const keys = []
      for (const _key in _target.keys) {
        const k = _target.keys[_key]
        if (!k.virtual && !k.isAssociation && !k.value) {
          keys.push({ ref: [_key] })
        }
      }

      // `where` needs to be wrapped to also support `where == ['exists', { SELECT }]` which is not allowed in `START WHERE`
      const clone = q.clone()
      clone.columns(keys)
      clone.SELECT.recurse = undefined
      clone.SELECT.expand = undefined // omits JSON
      where = [{ list: keys }, 'in', clone]
    }

    const requiredComputedColumns = { PARENT_ID: true, NODE_ID: true }
    if (!_internal) requiredComputedColumns.RANK = true
    const addComputedColumn = (name) => {
      if (requiredComputedColumns[name]) return
      requiredComputedColumns[name] = true
    }

    // The hierarchy functions will output the following columns. Which might clash with the entity columns
    const reservedColumnNames = {
      PARENT_ID: 1, NODE_ID: 1,
      HIERARCHY_RANK: 1, HIERARCHY_DISTANCE: 1, HIERARCHY_LEVEL: 1, HIERARCHY_TREE_SIZE: 1
    }
    const availableComputedColumns = {
      // Input computed columns
      PARENT_ID: false,
      NODE_ID: false,

      // Output computed columns
      RANK: { xpr: [{ ref: ['HIERARCHY_RANK'] }, '-', { val: 1, param: false }], as: 'RANK' },
      Distance: { func: where?.length ? 'min' : 'max', args: [{ ref: ['HIERARCHY_DISTANCE'] }], as: 'Distance' },
      DistanceFromRoot: { xpr: [{ ref: ['HIERARCHY_LEVEL'] }, '-', { val: 1, param: false }], as: 'DistanceFromRoot' },
      DrillState: false,
      LimitedDescendantCount: { xpr: [{ ref: ['HIERARCHY_TREE_SIZE'] }, '-', { val: 1, param: false }], as: 'LimitedDescendantCount' },
      LimitedRank: { xpr: [{ func: 'row_number', args: [] }, 'OVER', { xpr: ['ORDER', 'BY', { ref: ['HIERARCHY_RANK'] }, 'ASC'] }, '-', { val: 1, param: false }], as: 'LimitedRank' }
    }

    const columnsFiltered = columns
      .filter(x => {
        if (x.element?.isAssociation) return false
        const name = this.column_name(x)
        if (name === '$$RN$$') return false
        // REVISIT: ensure that the selected column is one of the hierarchy computed columns by unifying their common definition
        if (x.element?.['@Core.Computed'] && name in availableComputedColumns) {
          addComputedColumn(name)
          return false
        }
        return true
      })
    const columnsOut = []
    const columnsIn = []
    const target = q._target || q.target
    for (const name in target.elements) {
      const ref = { ref: [name] }
      const element = target.elements[name]
      if (element.virtual || element.value || element.isAssociation) continue
      if (element['@Core.Computed'] && name in availableComputedColumns) continue
      if (name.toUpperCase() in reservedColumnNames) ref.as = `$$${name}$$`
      columnsIn.push(ref)
      const foreignkey4 = element._foreignKey4
      if (
        from.args ||
        columnsFiltered.find(c => this.column_name(c) === name) ||
        // foreignkey needs to be included when the association is expanded
        (foreignkey4 && q.SELECT.columns.some(c => c.element?.isAssociation && c.element.name === foreignkey4))
      ) {
        columnsOut.push(ref.as ? { ref: [ref.as], as: name } : ref)
      }
    }

    const nodeKeys = []
    const parentKeys = []
    const association = target.elements[recurse.ref[0]]
    association._foreignKeys.forEach(fk => {
      nodeKeys.push(fk.childElement.name)
      parentKeys.push(fk.parentElement.name)
    })

    columnsIn.push(
      nodeKeys.length === 1
        ? { ref: nodeKeys, as: 'NODE_ID' }
        : { func: 'HIERARCHY_COMPOSITE_ID', args: nodeKeys.map(n => ({ ref: [n] })), as: 'NODE_ID' },
      parentKeys.length === 1
        ? { ref: parentKeys, as: 'PARENT_ID' }
        : { func: 'HIERARCHY_COMPOSITE_ID', args: parentKeys.map(n => ({ ref: [n] })), as: 'PARENT_ID' },
    )

    if (orderBy) {
      orderBy = orderBy.map(r => {
        const col = r.ref.at(-1)
        if (!columnsIn.find(c => this.column_name(c) === col)) {
          columnsIn.push({ ref: [col] })
        }
        return { ...r, ref: [col] }
      })
    }

    // In the case of join operations make sure to compute the hierarchy from the source table only
    const stableFrom = getStableFrom(from)
    const alias = stableFrom.as
    const source = () => {
      return ({
        func: 'HIERARCHY',
        args: [{ xpr: ['SOURCE', { SELECT: { columns: columnsIn, from: stableFrom } }, ...(orderBy ? ['SIBLING', 'ORDER', 'BY', `${this.orderBy(orderBy)}`] : [])] }],
        as: alias
      })
    }

    const expandedByNr = { list: [] } // DistanceTo(...,null)
    const expandedByOne = { list: [] } // DistanceTo(...,1)
    const expandedByZero = { list: [] } // not DistanceTo(...,null)
    let expandedFilter = []
    // If a root where exists it should always be DistanceFromRoot otherwise when a recurse.where exists with only DistanceTo() calls
    let distanceType = 'DistanceFromRoot'
    let distanceVal

    if (recurse.where) {
      distanceType = where?.length ? 'DistanceFromRoot' : 'Distance'
      if (recurse.where[0] === 'and') recurse.where = recurse.where.slice(1)
      expandedFilter = [...recurse.where]
      collectDistanceTo(expandedFilter)
    }

    const direction = where?.length ? 'ANCESTORS' : 'DESCENDANTS'
    // Ensure that the distance value is being computed
    if (distanceType) addComputedColumn(distanceType)

    let distanceClause = []
    if (distanceType === 'Distance') {
      const isOne = expandedByOne.list.length
      distanceClause = ['DISTANCE', ...(
        isOne
          ? [{ val: 1 }]
          : ['FROM', { val: 1 }]
      )]
      where = [{ ref: ['NODE_ID'] }, 'IN', isOne ? expandedByOne : expandedByNr]
      expandedFilter = []
    }

    availableComputedColumns.DrillState = {
      xpr: [ // When the node doesn't have children make it a leaf
        'CASE', 'WHEN', { ref: ['HIERARCHY_TREE_SIZE'] }, '=', { val: 1, param: false }, 'THEN', { val: 'leaf', param: false },
        ...(where?.length // When there is a where filter the final node will always be a leaf
          ? ['WHEN', { func: where?.length ? 'min' : 'max', args: [{ ref: ['HIERARCHY_DISTANCE'] }] }, '=', { val: 0, param: false }, 'THEN', { val: 'leaf', param: false }]
          : []
        ), // When having expanded by 0 level nodes make sure they are collapsed
        ...(expandedByZero.list.length
          ? ['WHEN', { ref: ['NODE_ID'] }, 'IN', expandedByZero, 'THEN', { val: 'collapsed', param: false }]
          : []
        ), // When having expanded by null or one nodes compute them as expanded
        ...(expandedByNr.list.length || expandedByOne.list.length
          ? ['WHEN', { ref: ['NODE_ID'] }, 'IN', { list: [...expandedByNr.list, ...expandedByOne.list] }, 'THEN', { val: 'expanded', param: false }]
          : []
        ), // When having expanded by one level node make its children collapsed
        ...(expandedByOne.list.length
          ? ['WHEN', { ref: ['PARENT_ID'] }, 'IN', expandedByOne, 'THEN', { val: 'collapsed', param: false }]
          : []
        ), // When using DistanceFromRoot compute all entries within the levels as expanded
        ...(distanceType === 'DistanceFromRoot' && distanceVal
          ? [
            'WHEN', { ref: ['HIERARCHY_LEVEL'] }, '<>', { val: distanceVal.val + 1 },
            'THEN', { val: 'expanded', param: false },
          ]
          : []
        ), // Default to expanded when default filter behavior is truthy
        'ELSE', { val: (recurse.where && !expandedByZero.list.length) && distanceType ? 'collapsed' : 'expanded', param: false },
        'END',
      ],
      as: 'DrillState'
    }

    for (const name in requiredComputedColumns) {
      const def = availableComputedColumns[name]
      if (def) columnsOut.push(def)
    }
    if (_internal) columnsOut.push({ ref: ['NODE_ID'] })

    const graph = distanceType === 'DistanceFromRoot' && !where
      ? { SELECT: { columns: columnsOut, from: source(), where: expandedFilter } }
      : {
        SELECT: {
          columns: columnsOut,
          from: {
            func: `HIERARCHY_${direction}`,
            args: [{
              xpr: [
                'SOURCE', source(), 'AS', this.quote(alias),
                'START', 'WHERE', {
                  xpr: where // Requires special where logic before being put into the args
                    ? from.args
                      ? [{ ref: ['NODE_ID'] }, 'IN', { SELECT: { columns: [columnsIn.find(c => c.as === 'NODE_ID')], from, where: where } }]
                      : this.is_comparator?.({ xpr: where }) ?? true ? where : [...where, '=', { val: true, param: false }]
                    : [{ ref: ['PARENT_ID'] }, '=', { val: null }]
                },
                ...distanceClause
              ]
            }]
          },
          where: expandedFilter.length ? expandedFilter : undefined,
          orderBy: [{ ref: ['HIERARCHY_RANK'], sort: 'asc' }],
          groupBy: [{ ref: ['NODE_ID'] }, { ref: ['PARENT_ID'] }, { ref: ['HIERARCHY_RANK'] }, { ref: ['HIERARCHY_LEVEL'] }, { ref: ['HIERARCHY_TREE_SIZE'] }, ...columnsOut.filter(c => c.ref)],
        }
      }

    // Only apply result join if the columns contain a references which doesn't start with the source alias
    if (from.args && columns.find(c => c.ref?.[0] === alias)) {
      graph.as = alias
      return this.from(setStableFrom(from, graph))
    }

    return `(${this.SELECT(graph)})${alias ? ` AS ${this.quote(alias)}` : ''} `

    function collectDistanceTo(where, innot = false) {
      for (let i = 0; i < where.length; i++) {
        const c = where[i]
        if (c === 'not') {
          distanceType = 'DistanceFromRoot'
          innot = true
        }
        else if (c.func === 'DistanceTo') {
          const expr = c.args[0]
          // { func: 'HIERARCHY_COMPOSITE_ID', args: nodeKeys.map(n => ({ val: cur[n] })) }
          const to = c.args[1].val
          const list = to === 1
            ? expandedByOne
            : innot
              ? expandedByZero
              : expandedByNr

          if (!list._where) {
            list._where = []
            where.splice(i, 1,
              ...(to === 1
                ? [{ ref: ['PARENT_ID'] }, 'IN', list]
                : [{ ref: ['NODE_ID'] }, 'IN', {
                  SELECT: {
                    _internal: true,
                    columns: [{ ref: ['NODE_ID'], element: { '@Core.Computed': true } }],
                    from: q.SELECT.from,
                    recurse: {
                      ref: recurse.ref,
                      where: list._where,
                    },
                  },
                  target,
                }])
            )
            i += 2
          } else {
            // Remove current entry from where
            if (where[i - 1] === 'not') {
              where.splice(i - 2, 3)
              i -= 3
            } else {
              where.splice(i - 1, 2)
              i -= 2
            }
          }
          list.list.push(expr)
          list._where.push(c)
        }
        else if (c.ref?.[0] === 'DistanceFromRoot') {
          distanceType = 'DistanceFromRoot'
          where[i] = { ref: ['HIERARCHY_LEVEL'] }
          i += 2
          distanceVal = where[i]
          where[i] = { val: where[i].val + 1 }
        }
      }
    }

    function getStableFrom(from) {
      if (from.args) return getStableFrom(from.args[0])
      return from
    }

    function setStableFrom(from, src) {
      if (from.args) {
        const ret = { ...from }
        ret.args = [...ret.args]
        ret.args[0] = setStableFrom(ret.args[0], src)
        return ret
      }
      return src
    }
  }

  /**
   * Renders a column clause into generic SQL
   * @param {import('./infer/cqn').SELECT} param0
   * @returns {string} SQL
   */
  SELECT_columns(q) {
    const ret = []
    const arr = q.SELECT.columns ?? ['*']
    for (const x of arr) {
      if (x.SELECT?.count) arr.push(this.SELECT_count(x))
      ret.push(this.column_expr(x, q))
    }
    return ret
  }

  /**
   * Renders a JSON select around the provided SQL statement
   * @param {import('./infer/cqn').SELECT} param0
   * @param {string} sql
   * @returns {string} SQL
   */
  SELECT_expand(q, sql) {
    if (!('elements' in q)) return sql

    const SELECT = q.SELECT
    if (!SELECT.columns) return sql

    const isRoot = SELECT.expand === 'root'
    const isSimple = _simple_queries &&
      isRoot && // Simple queries are only allowed to have a root
      !ObjectKeys(q.elements).some(e =>
        _strict_booleans && q.elements[e].type === 'cds.Boolean' || // REVISIT: Booleans require json for sqlite
        q.elements[e].isAssociation || // Indicates columns contains an expand
        q.elements[e].$assocExpand || // REVISIT: sometimes associations are structs
        q.elements[e].items // Array types require to be inlined with a json result
      )

    let cols = SELECT.columns.map(isSimple
      ? x => {
        const name = this.column_name(x)
        const escaped = `${name.replace(/"/g, '""')}`
        return `${this.output_converter4(x.element, this.quote(name))} AS "${escaped}"`
      }
      : x => {
        const name = this.column_name(x)
        return `${this.string(`$.${JSON.stringify(name)}`)},${this.output_converter4(x.element, this.quote(name))}`
      }).flat()

    if (isSimple) return `SELECT ${cols} FROM (${sql})`

    // Prevent SQLite from hitting function argument limit of 100
    let obj = "'{}'"
    for (let i = 0; i < cols.length; i += 48) {
      obj = `jsonb_insert(${obj},${cols.slice(i, i + 48)})`
    }
    return `SELECT ${isRoot || SELECT.one ? obj.replace('jsonb', 'json') : `jsonb_group_array(${obj})`} as _json_ FROM (${sql})`
  }

  SELECT_count(q) {
    const countQuery = cds.ql.clone(q, {
      columns: [{ func: 'count' }],
      one: 0, limit: 0, orderBy: 0, expand: 0, count: 0
    })
    countQuery.as = q.as + '@odata.count'
    countQuery.elements = undefined
    countQuery.element = cds.builtin.types.Int64
    return countQuery
  }

  /**
   * Renders a SELECT column expression into generic SQL
   * @param {import('./infer/cqn').col} x
   * @returns {string} SQL
   */
  column_expr(x, q) {
    if (x === '*') return '*'

    let sql = x.param !== true && typeof x.val === 'number' ? this.expr({ param: false, __proto__: x }) : this.expr(x)
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
    return typeof x.as === 'string' ? x.as : x.func || x.val
  }

  /**
   * Renders a FROM clause into generic SQL
   * @param {import('./infer/cqn').source} from
   * @returns {string} SQL
   */
  from(from, q) {
    const { ref, as } = from
    const _aliased = as ? s => s + ` as ${this.quote(as)}` : s => s
    if (ref) {
      let z = ref[0]
      if (z.args) {
        return _aliased(`${this.quote(this.name(z, q))}${this.from_args(z.args)}`)
      }
      return _aliased(this.quote(this.name(z, q)))
    }
    if (from.SELECT) return _aliased(`(${this.SELECT(from)})`)
    if (from.join) return `${this.from(from.args[0])} ${from.join} JOIN ${this.from(from.args[1])}${from.on ? ` ON ${this.where(from.on)}` : ''}`
    if (from.func) return _aliased(this.func(from))
  }

  /**
   * Renders a FROM clause into generic SQL
   * @param {import('./infer/cqn').source} from
   * @returns {string} SQL
   */
  with(query) {
    this._with ??= []
    this._with.push(query)
    return { ref: [query.as] }
  }

  /**
   * Renders a FROM clause for when the query does not have a target
   * @returns {string} SQL
   */
  from_dummy() {
    return ''
  }

  /**
   * Renders a FROM clause into generic SQL
   * @param {import('./infer/cqn').ref['ref'][0]['args']} args
   * @returns {string} SQL
   */
  from_args(args) {
    args
    cds.error`Parameterized views are not supported by ${this.constructor.name}`
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
    return orderBy.map(c => {
      const o = (localized && this.context.locale)
        ? this.expr(c) +
        (c.element?.[this.class._localized] ? ' COLLATE NOCASE' : '') +
        (c.sort?.toLowerCase() === 'desc' || c.sort === -1 ? ' DESC' : ' ASC')
        : this.expr(c) + (c.sort?.toLowerCase() === 'desc' || c.sort === -1 ? ' DESC' : ' ASC')
      if (c.nulls) return o + ' NULLS ' + (c.nulls.toLowerCase() === 'first' ? 'FIRST' : 'LAST')
      return o
    })
  }

  /**
   * Renders an limit clause into generic SQL
   * @param {import('./infer/cqn').limit} param0
   * @returns {string} SQL
   * @throws {Error} When no rows are defined
   */
  limit({ rows, offset }) {
    if (!rows) throw new Error('Rows parameter is missing in SELECT.limit(rows, offset)')
    return !offset ? this.val(rows) : `${this.val(rows)} OFFSET ${this.val(offset)}`
  }

  /**
   * Renders an forUpdate clause into generic SQL
   * @param {import('./infer/cqn').SELECT["SELECT"]["forUpdate"]} update
   * @returns {string} SQL
   */
  forUpdate(update) {
    const { wait, of, ignoreLocked } = update
    let sql = 'FOR UPDATE'
    if (!_empty(of)) sql += ` OF ${of.map(x => this.expr(x)).join(', ')}`
    if (ignoreLocked) sql += ' IGNORE LOCKED'
    if (typeof wait === 'number') sql += ` WAIT ${wait}`
    return sql
  }

  /**
   * Renders an forShareLock clause into generic SQL
   * @param {import('./infer/cqn').SELECT["SELECT"]["forShareLock"]} update
   * @returns {string} SQL
   */
  forShareLock(lock) {
    const { wait, of } = lock
    let sql = 'FOR SHARE LOCK'
    if (!_empty(of)) sql += ` OF ${of.map(x => this.expr(x)).join(', ')}`
    if (typeof wait === 'number') sql += ` WAIT ${wait}`
    return sql
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
          : INSERT.from || INSERT.as
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
    const elements = q.elements || q._target?.elements
    if (!elements && !INSERT.entries?.length) {
      return // REVISIT: mtx sends an insert statement without entries and no reference entity
    }
    const columns = elements
      ? ObjectKeys(elements).filter(c => c in elements && !elements[c].virtual && !elements[c].value && !elements[c].isAssociation)
      : ObjectKeys(INSERT.entries[0])

    /** @type {string[]} */
    this.columns = columns

    const alias = INSERT.into.as
    const entity = this.name(q._target?.name || INSERT.into.ref[0], q)
    if (!elements) {
      this.entries = INSERT.entries.map(e => columns.map(c => e[c]))
      const param = this.param.bind(this, { ref: ['?'] })
      return (this.sql = `INSERT INTO ${this.quote(entity)}${alias ? ' as ' + this.quote(alias) : ''} (${this.columns.map(c => this.quote(c))}) VALUES (${columns.map(param)})`)
    }

    // Include this.values for placeholders
    /** @type {unknown[][]} */
    this.entries = []
    if (INSERT.entries[0] instanceof Readable && !INSERT.entries[0].readableObjectMode) {
      INSERT.entries[0].type = 'json'
      this.entries = [[...this.values, INSERT.entries[0]]]
    } else {
      const entries = INSERT.entries[0]?.[Symbol.iterator] || INSERT.entries[0]?.[Symbol.asyncIterator] || INSERT.entries[0] instanceof Readable ? INSERT.entries[0] : INSERT.entries
      const stream = Readable.from(this.INSERT_entries_stream(entries), { objectMode: false })
      stream.type = 'json'
      stream._raw = entries
      this.entries = [[...this.values, stream]]
    }

    const extractions = this._managed = this.managed(columns.map(c => ({ name: c })), elements)
    return (this.sql = `INSERT INTO ${this.quote(entity)}${alias ? ' as ' + this.quote(alias) : ''} (${this.columns.map(c => this.quote(c))
      }) SELECT ${extractions.map(c => c.insert)} FROM json_each(?)`)
  }

  async *INSERT_entries_stream(entries, binaryEncoding = 'base64') {
    const elements = this.cqn._target?.elements || {}
    const bufferLimit = 65536 // 1 << 16
    let buffer = '['

    let sep = ''
    for await (const row of entries) {
      buffer += `${sep}{`
      if (!sep) sep = ','

      let sepsub = ''
      for (const key in row) {
        let val = row[key]
        if (val === undefined) continue
        const keyJSON = `${sepsub}${JSON.stringify(key)}:`
        if (!sepsub) sepsub = ','

        if (val instanceof Readable) {
          buffer += `${keyJSON}"`

          // TODO: double check that it works
          val.setEncoding(binaryEncoding)
          for await (const chunk of val) {
            buffer += chunk
            if (buffer.length > bufferLimit) {
              yield buffer
              buffer = ''
            }
          }

          buffer += '"'
        } else {
          if (val != null && elements[key]?.type in this.BINARY_TYPES) {
            val = Buffer.from(val, 'base64').toString(binaryEncoding)
          }
          buffer += `${keyJSON}${JSON.stringify(val)}`
        }
      }
      buffer += '}'
      if (buffer.length > bufferLimit) {
        yield buffer
        buffer = ''
      }
    }

    buffer += ']'
    yield buffer
  }

  async *INSERT_rows_stream(entries, binaryEncoding = 'base64') {
    const elements = this.cqn._target?.elements || {}
    const bufferLimit = 65536 // 1 << 16
    let buffer = '['

    let sep = ''
    for (const row of entries) {
      buffer += `${sep}[`
      if (!sep) sep = ','

      let sepsub = ''
      for (let key = 0; key < row.length; key++) {
        let val = row[key]
        if (val instanceof Readable) {
          buffer += `${sepsub}"`

          // TODO: double check that it works
          val.setEncoding(binaryEncoding)
          for await (const chunk of val) {
            buffer += chunk
            if (buffer.length > bufferLimit) {
              yield buffer
              buffer = ''
            }
          }

          buffer += '"'
        } else {
          if (val != null && elements[this.columns[key]]?.type in this.BINARY_TYPES) {
            val = Buffer.from(val, 'base64').toString(binaryEncoding)
          }
          buffer += `${sepsub}${val == null ? 'null' : JSON.stringify(val)}`
        }

        if (!sepsub) sepsub = ','
      }
      buffer += ']'
      if (buffer.length > bufferLimit) {
        yield buffer
        buffer = ''
      }
    }

    buffer += ']'
    yield buffer
  }

  /**
   * Renders an INSERT query with rows property
   * @param {import('./infer/cqn').INSERT} q
   * @returns {string} SQL
   */
  INSERT_rows(q) {
    const { INSERT } = q
    const entity = this.name(q._target?.name || INSERT.into.ref[0], q)
    const alias = INSERT.into.as
    const elements = q.elements || q._target?.elements
    const columns = this.columns = INSERT.columns || cds.error`Cannot insert rows without columns or elements`

    if (!elements) {
      this.entries = INSERT.rows
      const param = this.param.bind(this, { ref: ['?'] })
      return (this.sql = `INSERT INTO ${this.quote(entity)}${alias ? ' as ' + this.quote(alias) : ''} (${this.columns.map(c => this.quote(c))}) VALUES (${columns.map(param)})`)
    }

    if (INSERT.rows[0] instanceof Readable) {
      INSERT.rows[0].type = 'json'
      this.entries = [[...this.values, INSERT.rows[0]]]
    } else {
      const stream = Readable.from(this.INSERT_rows_stream(INSERT.rows), { objectMode: false })
      stream.type = 'json'
      stream._raw = INSERT.rows
      this.entries = [[...this.values, stream]]
    }

    const extraction = (this._managed = this.managed(columns.map(c => ({ name: c })), elements))
      .slice(0, columns.length)
      .map(c => c.converter(c.extract))

    return (this.sql = `INSERT INTO ${this.quote(entity)}${alias ? ' as ' + this.quote(alias) : ''} (${this.columns.map(c => this.quote(c))
      }) SELECT ${extraction} FROM json_each(?)`)
  }

  /**
   * Renders an INSERT query with values property
   * @param {import('./infer/cqn').INSERT} q
   * @returns {string} SQL
   */
  INSERT_values(q) {
    let { columns, values } = q.INSERT
    return this.render({ __proto__: q, INSERT: { __proto__: q.INSERT, columns, rows: [values] } })
  }

  /**
   * Renders an INSERT query from SELECT query
   * @param {import('./infer/cqn').INSERT} q
   * @returns {string} SQL
   */
  INSERT_select(q) {
    const { INSERT } = q
    const entity = this.name(q._target.name, q)
    const alias = INSERT.into.as
    const elements = q.elements || q._target?.elements || {}
    let columns = (this.columns = (INSERT.columns || ObjectKeys(elements)).filter(
      c => c in elements && !elements[c].virtual && !elements[c].isAssociation,
    ))

    const src = this.cqn4sql(INSERT.from)
    const extractions = this._managed = this.managed(columns.map(c => ({ name: c, sql: `NEW.${this.quote(c)}` })), elements)
    const sql = extractions.length > columns.length
      ? `SELECT ${extractions.map(c => `${c.insert} AS ${this.quote(c.name)}`)} FROM (${this.SELECT(src)}) AS NEW`
      : this.SELECT(src)
    if (extractions.length > columns.length) columns = this.columns = extractions.map(c => c.name)
    this.sql = `INSERT INTO ${this.quote(entity)}${alias ? ' as ' + this.quote(alias) : ''} (${columns.map(c => this.quote(c))}) ${sql}`
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

  static localized = { String: { get() { return this['@cds.collate'] !== false } }, UUID: false }

  // UPSERT Statements ------------------------------------------------

  /**
   * Renders an UPSERT query into generic SQL
   * @param {import('./infer/cqn').UPDATE} q
   * @returns {string} SQL
   */
  UPSERT(q) {
    const { UPSERT } = q

    let sql = this.INSERT({ __proto__: q, INSERT: UPSERT })
    if (!q._target?.keys) return sql
    const keys = []
    for (const k of ObjectKeys(q._target?.keys)) {
      const element = q._target.keys[k]
      if (element.isAssociation || element.virtual) continue
      keys.push(k)
    }

    const elements = q._target?.elements || {}
    // temporal data
    for (const k of ObjectKeys(elements)) {
      if (elements[k]['@cds.valid.from']) keys.push(k)
    }

    const keyCompare = keys
      .map(k => `NEW.${this.quote(k)}=OLD.${this.quote(k)}`)
      .join(' AND ')

    let columns = this.columns // this.columns is computed as part of this.INSERT
    const entity = this.name(q._target?.name || UPSERT.into.ref[0], q)
    if (UPSERT.entries || UPSERT.rows || UPSERT.values) {
      const managed = this._managed.slice(0, columns.length)

      const extractkeys = managed
        .filter(c => keys.includes(c.name))
        .map(c => `${c.onInsert || c.sql} as ${this.quote(c.name)}`)

      sql = `SELECT ${managed.map(c => c.upsert
        .replace(/value->/g, '"$$$$value$$$$"->')
        .replace(/json_type\(value,/g, 'json_type("$$$$value$$$$",'))
        } FROM (SELECT value as "$$value$$", ${extractkeys} from json_each(?)) as NEW LEFT JOIN ${this.quote(entity)} AS OLD ON ${keyCompare}`
    } else {
      const extractions = this._managed
      if (this.values) this.values = [] // Clear previously computed values
      const src = this.cqn4sql(UPSERT.from || UPSERT.as)
      const aliasedQuery = cds.ql.SELECT
        .columns(src.SELECT.columns
          .map((c, i) => ({ ref: [this.column_name(c)], as: this.columns[i] }))
        )
        .from(src)
      sql = `SELECT ${extractions.map(c => `${c.upsert}`)} FROM (${this.SELECT(aliasedQuery)}) AS NEW LEFT JOIN ${this.quote(entity)} AS OLD ON ${keyCompare}`
      if (extractions.length > columns.length) columns = this.columns = extractions.map(c => c.name)
      this.entries = [this.values]
    }

    const updateColumns = columns.filter(c => {
      if (keys.includes(c)) return false //> keys go into ON CONFLICT clause
      let e = elements[c]
      if (!e) return true //> pass through to native SQL columns not in CDS model
      if (e.virtual) return true //> skip virtual elements
      if (e.value) return true //> skip calculated elements
      // if (e.isAssociation) return true //> this breaks a a test in @sap/cds -> need to follow up how to correctly handle deep upserts
      else return true
    }).map(c => `${this.quote(c)} = excluded.${this.quote(c)}`)

    return (this.sql = `INSERT INTO ${this.quote(entity)} (${columns.map(c => this.quote(c))}) ${sql
      } WHERE TRUE ON CONFLICT(${keys.map(c => this.quote(c))}) DO ${updateColumns.length ? `UPDATE SET ${updateColumns}` : 'NOTHING'}`)
  }

  // UPDATE Statements ------------------------------------------------

  /**
   * Renders an UPDATE query into generic SQL
   * @param {import('./infer/cqn').UPDATE} q
   * @returns {string} SQL
   */
  UPDATE(q) {
    const { entity, with: _with, data, where } = q.UPDATE
    const elements = q._target?.elements
    let sql = `UPDATE ${this.quote(this.name(entity.ref?.[0] || entity, q))}`
    if (entity.as) sql += ` AS ${this.quote(entity.as)}`

    let columns = []
    if (data) _add(data, val => this.val({ val }))
    if (_with) _add(_with, x => this.expr(x))
    function _add(data, sql4) {
      for (let c in data) {
        const columnExistsInDatabase =
          elements && c in elements && !elements[c].virtual && !elements[c].isAssociation && !elements[c].value
        if (!elements || columnExistsInDatabase) {
          columns.push({ name: c, sql: sql4(data[c]) })
        }
      }
    }

    const extraction = this.managed(columns, elements)
      .filter((c, i) => columns[i] || c.onUpdate)
      .map((c, i) => `${this.quote(c.name)}=${!columns[i] ? c.onUpdate : c.sql}`)

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
  DELETE(q) {
    const { DELETE: { from, where } } = q
    let sql = `DELETE FROM ${this.from(from, q)}`
    if (where) sql += ` WHERE ${this.where(where)}`
    return (this.sql = sql)
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
    if (x.param) return wrap(this.param(x))
    if ('ref' in x) return wrap(this.ref(x))
    if ('val' in x) return wrap(this.val(x))
    if ('func' in x) return wrap(this.func(x))
    if ('xpr' in x) return wrap(this.xpr(x))
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
        if (x.xpr && !x.func) return `(${this.xpr(x)})`
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
    if (x === '=') return xpr[i + 1]?.val === null
      ? _inline_null(xpr[i + 1]) || 'is'
      : '='

    // Translate == to IS NOT NULL for rhs operand being NULL literal, otherwise ...
    // Translate == to IS NOT DISTINCT FROM, unless both operands cannot be NULL
    if (x === '==') return xpr[i + 1]?.val === null
      ? _inline_null(xpr[i + 1]) || 'is'
      : _not_null(i - 1) && _not_null(i + 1)
        ? '='
        : this.is_not_distinct_from_

    // Translate != to IS NULL for rhs operand being NULL literal, otherwise...
    // Translate != to IS DISTINCT FROM, unless both operands cannot be NULL
    if (x === '!=') return xpr[i + 1]?.val === null
      ? _inline_null(xpr[i + 1]) || 'is not'
      : _not_null(i - 1) && _not_null(i + 1)
        ? '<>'
        : this.is_distinct_from_

    else return x

    function _inline_null(n) {
      n.param = false
    }

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
      case '$now': return this.func({ func: 'session_context', args: [{ val: '$now', param: false }] }) // REVISIT: why do we need param: false here?
      case '$user': return this.func({ func: 'session_context', args: [{ val: '$user.' + ref[1] || 'id', param: false }] }) // REVISIT: same here?
      default: return ref.map(r => this.quote(r)).join('.')
    }
  }

  /**
   * Renders a value into the correct SQL syntax or a placeholder for a prepared statement
   * @param {import('./infer/cqn').val} param0
   * @returns {string} SQL
   */
  val({ val, param }) {
    switch (typeof val) {
      case 'function': throw new Error('Function values not supported.')
      case 'undefined': val = null
        break
      case 'boolean': return `${val}`
      case 'object':
        if (val !== null) {
          if (val instanceof Date) val = val.toJSON() // returns null if invalid
          else if (val instanceof Readable); // go on with default below
          else if (Buffer.isBuffer(val)); // go on with default below
          else if (is_regexp(val)) val = val.source
          else val = JSON.stringify(val)
        }
    }
    if (!this.values || param === false) {
      switch (typeof val) {
        case 'string': return this.string(val)
        case 'object': return 'NULL'
        default:
          return `${val}`
      }
    }
    this.values.push(val)
    return '?'
  }

  static Functions = require('./cql-functions')
  /**
   * Renders a function call into mapped SQL definitions from the Functions definition
   * @param {import('./infer/cqn').func} param0
   * @returns {string} SQL
   */
  func({ func, args, xpr }) {
    const wrap = e => (e === '*' ? e : { __proto__: e, toString: (x = e) => this.expr(x) })
    args = args || []
    if (Array.isArray(args)) {
      args = args.map(wrap)
    } else if (typeof args === 'object') {
      const org = args
      const wrapped = {
        toString: () => {
          const ret = []
          for (const prop in org) {
            ret.push(`${this.quote(prop)} => ${wrapped[prop]}`)
          }
          return ret.join(',')
        }
      }
      for (const prop in args) {
        wrapped[prop] = wrap(args[prop])
      }
      args = wrapped
    } else {
      cds.error`Invalid arguments provided for function '${func}' (${args})`
    }
    const fn = this.class.Functions[func]?.apply(this, Array.isArray(args) ? args : [args]) || `${func}(${args})`
    if (xpr) return `${fn} ${this.xpr({ xpr })}`
    return fn
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
   * @param {import('./infer/cqn').Query} query
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
    if (s in this.class.ReservedWords || !/^[A-Za-z_][A-Za-z_$0-9]*$/.test(s)) return '"' + s + '"'
    return s
  }

  /**
   * Converts the columns array into an array of SQL expressions that extract the correct value from inserted JSON data
   * @param {object[]} columns
   * @param {import('./infer/cqn').elements} elements
   * @param {Boolean} isUpdate
   * @returns {string[]} Array of SQL expressions for processing input JSON data
   */
  managed(columns, elements) {
    const cdsOnInsert = '@cds.on.insert'
    const cdsOnUpdate = '@cds.on.update'

    const { _convertInput } = this.class
    // Ensure that missing managed columns are added
    const requiredColumns = !elements
      ? []
      : ObjectKeys(elements)
        .filter(e => {
          const element = elements[e]
          // Actual mandatory check
          if (!(element.default || element[cdsOnInsert] || element[cdsOnUpdate])) return false
          // Physical column check
          if (!element || element.virtual || element.isAssociation) return false
          // Existence check
          if (columns.find(c => c.name === e)) return false
          return true
        })
        .map(name => ({ name, sql: 'NULL' }))

    const keys = ObjectKeys(elements).filter(e => elements[e].key && !elements[e].isAssociation)
    const keyZero = keys[0] && this.quote(keys[0])

    return [...columns, ...requiredColumns].map(({ name, sql }) => {
      const element = elements?.[name] || {}

      const converter = a => element[_convertInput]?.(a, element) || a
      let extract
      if (!sql) {
        ({ sql, extract } = this.managed_extract(name, element, converter))
      } else {
        extract = sql = converter(sql)
      }
      // if (sql[0] !== '$') sql = converter(sql, element)

      let onInsert = this.managed_session_context(element[cdsOnInsert]?.['='])
        || this.managed_session_context(element.default?.ref?.[0])
        || (element.default && { __proto__: element.default, param: false })
      let onUpdate = this.managed_session_context(element[cdsOnUpdate]?.['='])

      if (onInsert) onInsert = this.expr(onInsert)
      if (onUpdate) onUpdate = this.expr(onUpdate)

      const qname = this.quote(name)

      const insert = onInsert ? this.managed_default(name, converter(onInsert), sql) : sql
      const update = onUpdate ? this.managed_default(name, converter(onUpdate), sql) : sql
      const upsert = keyZero && (
        // upsert requires the keys to be provided for the existance join (default values optional)
        element.key
          // If both insert and update have the same managed definition exclude the old value check
          || (onInsert && onUpdate && insert === update)
          ? `${insert} as ${qname}`
          : `CASE WHEN OLD.${keyZero} IS NULL THEN ${
          // If key of old is null execute insert
          insert
          } ELSE ${
          // Else execute managed update or keep old if no new data if provided
          onUpdate ? update : this.managed_default(name, `OLD.${qname}`, update)
          } END as ${qname}`
      )

      return {
        name, // Element name
        sql, // Reference SQL
        extract, // Source SQL
        converter, // Converter logic
        // action specific full logic
        insert, update, upsert,
        // action specific isolated logic
        onInsert, onUpdate
      }
    })
  }

  managed_extract(name, element, converter) {
    const { UPSERT, INSERT } = this.cqn
    const extract = !(INSERT?.entries || UPSERT?.entries) && (INSERT?.rows || UPSERT?.rows)
      ? `value->>${this.string(`$[${this.columns.indexOf(name)}]`)}`
      : `value->>${this.string(`$.${JSON.stringify(name)}`)}`
    const sql = converter?.(extract) || extract
    return { extract, sql }
  }

  managed_session_context(src) {
    const val = _managed[src]
    return val && { func: 'session_context', args: [{ val, param: false }] }
  }

  managed_default(name, managed, src) {
    return `(CASE WHEN json_type(value,${this.managed_extract(name).extract.slice(8)}) IS NULL THEN ${managed} ELSE ${src} END)`
  }
}

Readable.prototype[require('node:util').inspect.custom] = Readable.prototype.toJSON = function () { return this._raw || `[object ${this.constructor.name}]` }

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
module.exports = (q, m) => new CQN2SQLRenderer({ model: m }).render(cqn4sql(q, m))
module.exports.class = CQN2SQLRenderer
module.exports.classDefinition = CQN2SQLRenderer // class is a reserved typescript word
