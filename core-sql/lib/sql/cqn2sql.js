const cds = require('../../cds')
const cds_infer = require('../ql/cds.infer')
const cqn4sql = require('./cqn4sql')

const DEBUG = (()=>{
  let DEBUG = cds.debug('sql-json'); if (DEBUG) return DEBUG
  else DEBUG = cds.debug('sql|sqlite'); if (DEBUG) {
    return DEBUG
    // (sql, ...more) => DEBUG (sql.replace(/(?:SELECT[\n\r\s]+(json_group_array\()?[\n\r\s]*json_insert\((\n|\r|.)*?\)[\n\r\s]*\)?[\n\r\s]+as[\n\r\s]+_json_[\n\r\s]+FROM[\n\r\s]*\(|\)[\n\r\s]*(\)[\n\r\s]+AS )|\)$)/gim,(a,b,c,d) => d || ''), ...more)
    // FIXME: looses closing ) on INSERT queries
  }
})()


class CQN2SQLRenderer {

  constructor(context) {
    this.context = cds.context || context
    this.class = new.target // for IntelliSense
    this.class._init() // is a noop for subsequent calls
  }
  static _init() {
    const _add_mixins = (aspect, mixins) => {
      const fqn = this.name + aspect
      const types = cds.builtin.types
      for (let each in mixins) {
        const def = types[each]; if (!def) continue
        Object.defineProperty (def, fqn, { value: mixins[each] })
      }
      return fqn
    }
    this._localized = _add_mixins (':localized', this.localized)
    this._convertInput = _add_mixins (':convertInput', this.InputConverters)
    this._convertOutput = _add_mixins (':convertOutput', this.OutputConverters)
    this._sqlType = _add_mixins (':sqlType', this.TypeMap)
    this._init = ()=>{} // makes this a noop for subsequent calls
  }

  render (q, vars) {
    const cmd = q.cmd || Object.keys(q)[0] // SELECT, INSERT, ...
    this.sql = ''           // to have it as first property for debugging
    this.values = []        // prepare values, filled in by subroutines
    this[cmd](this.cqn = q) // actual sql rendering happens here
    if (vars?.length && !this.values.length) this.values = vars
    DEBUG?.(this.sql, this.entries || this.values)
    return this
  }

  infer(q) {
    return q.target ? q : cds_infer(q)
  }


  // CREATE Statements ------------------------------------------------


  CREATE(q) {
    const { target } = q, { query } = target
    const name = this.name(target.name)
    // Don't allow place holders inside views
    delete this.values
    this.sql = (!query || target['@cds.persistence.table'])
    ? `CREATE TABLE ${name} ( ${this.CREATE_elements(target.elements)} )`
    : `CREATE VIEW ${name} AS ${this.SELECT(cqn4sql(query))}`
    this.values = []
    return
  }

  CREATE_elements(elements) {
    let sql = ''
    for (let e in elements) {
      const definition = elements[e]
      if(definition.isAssociation) continue
      const s = this.CREATE_element(definition)
      if (s) sql += `${s}, `
    }
    return sql.slice(0, -2)
  }

  CREATE_element(element) {
    const type = this.type4(element)
    if (type) return this.quote(element.name) + ' ' + type
  }

  type4 (element) {
    if (!element._type) element = cds.builtin.types[element.type] || element
    const fn = element[this.class._sqlType]
    return fn?.(element) || (element._type)?.replace('cds.','').toUpperCase()
    || cds.error`Unsupported type: ${element.type}`
  }

  static TypeMap = { // Utilizing cds.linked inheritance
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


  DROP(q) {
    const { target } = q
    const isView = target.query || target.projection
    return this.sql = `DROP ${isView ? 'VIEW' : 'TABLE'} IF EXISTS ${this.name(target.name)}`
  }


  // SELECT Statements ------------------------------------------------


  SELECT(q) {
    let { from, expand, where, groupBy, having, orderBy, limit, one, distinct, localized } = q.SELECT
    if (!expand) expand = q.SELECT.expand = has_expands(q) || has_arrays(q)
    // REVISIT: When selecting from an entity that is not in the model the from.where are not normalized (as cqn4sql is skipped)
    if (!where &&  from?.ref?.length === 1 && from.ref[0]?.where) where = from.ref[0]?.where
    let columns = this.SELECT_columns(q)
    let x, sql = `SELECT`
    if (distinct)             sql += ` DISTINCT`
    if (!_empty(x = columns)) sql += ` ${x}`
    if (!_empty(x = from))    sql += ` FROM ${this.from(x)}`
    if (!_empty(x = where))   sql += ` WHERE ${this.where(x)}`
    if (!_empty(x = groupBy)) sql += ` GROUP BY ${this.groupBy(x)}`
    if (!_empty(x = having))  sql += ` HAVING ${this.having(x)}`
    if (!_empty(x = orderBy)) sql += ` ORDER BY ${this.orderBy(x,localized)}`
    if (one)                  sql += ` LIMIT ${this.limit({rows:{val:1}})}`
    else if ((x = limit))     sql += ` LIMIT ${this.limit(x)}`
    if (expand)               sql = this.SELECT_expand(q, sql)
    return this.sql = sql
  }

  SELECT_columns({SELECT}) {
    // REVISIT: We don't have to run x.as through this.column_name(), do we?
    if (!SELECT.columns) return '*'
    return SELECT.columns.map(x => this.column_expr(x) + (typeof x.as === 'string' ? ' as '+ this.quote(x.as) : ''))
  }

  SELECT_expand({ SELECT, elements }, sql) {
    if (!SELECT.columns) return sql
    if (!elements) return sql
    let cols = !SELECT.columns ? ['*'] : SELECT.columns.map(x => {
      const name = this.column_name(x)
      // REVISIT: can be removed when alias handling is resolved properly
      const d = elements[name] || elements[name.substring(1,name.length - 1)]
      let col = `'$.${name}',${this.output_converter4(d,this.quote(name))}`

      if (x.SELECT?.count) {
        // Return both the sub select and the count for @odata.count
        const qc = cds.ql.clone(x, { columns: [{ func: 'count' }], one: 1, limit: 0, orderBy: 0 })
        col += `, '$.${name}@odata.count',${this.expr(qc)}`
      }
      return col
    })

    // Prevent SQLite from hitting function argument limit of 100
    let colsLength = cols.length
    let obj = "'{}'"
    for(let i = 0; i < colsLength; i+= 48) {
      obj = `json_insert(${obj},${cols.slice(i,i + 48)})`
    }
    return `SELECT ${SELECT.one || SELECT.expand === 'root' ? obj : `json_group_array(${obj})`} as _json_ FROM (${sql})`
  }

  column_expr(x) {
    if (x.func && !x.as) x.as = x.func
    if (x?.element?.['@cds.extension']) {
      x.as = x.as || x.element.name
      return `extensions__->${this.string('$.'+x.element.name)}`
    }
    let sql = this.expr(x)
    return sql
  }

  from (from) {
    const { ref, as } = from, _aliased = as ? s => s + ` as ${this.quote(as)}` : s => s
    if (ref) return _aliased(this.quote(this.name(ref[0])))
    if (from.SELECT) return _aliased(`(${this.SELECT(from)})`)
    if (from.join) {
      const { join, args: [left, right], on } = from
      return `${this.from(left)} ${join} JOIN ${this.from(right)} ON ${this.xpr({ xpr: on })}`
    }
  }

  where(xpr) {
    return this.xpr({ xpr })
  }

  having(xpr) {
    return this.xpr({ xpr })
  }

  groupBy(clause) {
    return clause.map(c => this.expr(c))
  }

  orderBy(orderBy,localized) {
    return orderBy.map(localized
      ? c => this.expr(c) + (c.element?.[this.class._localized] ? ' COLLATE NOCASE' : '') + (c.sort === 'desc' || c.sort === -1 ? ' DESC' : ' ASC')
      : c => this.expr(c) + (c.sort === 'desc' || c.sort === -1 ? ' DESC' : ' ASC')
      )
  }

  limit({ rows, offset }) {
    if(!rows) throw new Error('Rows parameter is missing in SELECT.limit(rows, offset)')
    return !offset ? rows.val : `${rows.val} OFFSET ${offset.val}`
  }




  // INSERT Statements ------------------------------------------------


  INSERT(q) {
    const { INSERT } = q
    return INSERT.entries ? this.INSERT_entries(q)
      : INSERT.rows ? this.INSERT_rows(q)
      : INSERT.values ? this.INSERT_values(q)
      : INSERT.as ? this.INSERT_select(q)
      : cds.error`Missing .entries, .rows, or .values in ${q}`
  }

  INSERT_entries(q) {
    const { INSERT } = q
    const entity = this.name(q.target?.name || INSERT.into.ref[0])
    const alias = INSERT.into.as
    const elements = q.elements || q.target?.elements
    if(!elements && !INSERT.entries?.length) {
      return // REVISIT: mtx sends an insert statement without entries and no reference entity
    }
    const columns = (
      elements ? ObjectKeys(elements).filter(c => c in elements && !elements[c].virtual && !elements[c].isAssociation)
      : ObjectKeys(INSERT.entries[0])
    )
    this.columns = columns.filter(elements ? c => !elements[c]?.['@cds.extension'] : ()=>true).map(c => this.quote(c))

    const extractions = this.managed(columns.map(c => ({name:c})), elements, !!q.UPSERT)
    const extraction = extractions.map(c => {
      const element = elements?.[c.name]
      if(element?.['@cds.extension']) {
        return false
      }
      if(c.name === 'extensions__') {
        const merges = extractions.filter(c => elements?.[c.name]?.['@cds.extension'])
        if(merges.length) {
          c.sql = `json_set(ifnull(${c.sql},'{}'),${merges.map(c => this.string('$.'+c.name)+','+c.sql)})`
        }
      }
      return c
    })
    .filter(a => a)
    .map(c => c.sql)

    this.entries = [[JSON.stringify(INSERT.entries)]]
    return (this.sql = `INSERT INTO ${entity}${alias ? ' as ' + this.quote(alias) : ''} (${this.columns}) SELECT ${extraction} FROM json_each(?)`)
  }

  INSERT_rows(q) {
    const { INSERT } = q
    const entity = this.name(q.target?.name || INSERT.into.ref[0])
    const alias = INSERT.into.as
    const elements = q.elements || q.target?.elements
    if(!INSERT.columns && !elements) {
      throw cds.error`Cannot insert rows without columns or elements`
    }
    let columns = (INSERT.columns || (elements && ObjectKeys(elements)))
    if(elements){
      columns = columns.filter(c => c in elements && !elements[c].virtual && !elements[c].isAssociation)
    }
    this.columns = columns.map(c => this.quote(c))

    const inputConverterKey = this.class._convertInput
    const extraction = columns.map((c, i) => {
      const element = elements?.[c] || {}
      const extract = `value->>'$[${i}]'`
      const converter = element[inputConverterKey] || (e => e)
      return converter(extract, element)
    })

    this.entries = [[JSON.stringify(INSERT.rows)]]
    return (this.sql = `INSERT INTO ${entity}${alias ? ' as ' + this.quote(alias) : ''} (${this.columns}) SELECT ${extraction} FROM json_each(?)`)
  }

  INSERT_values (q){
    let { columns, values } = q.INSERT
    return this.INSERT_rows ({__proto__:q, INSERT:{__proto__: q.INSERT, columns, rows:[values] }})
  }

  INSERT_select(q) {
    const { INSERT } = q
    const entity = this.name(q.target.name)
    const alias = INSERT.into.as
    const elements = q.elements || q.target?.elements || {}
    const columns = this.columns = (
      INSERT.columns || ObjectKeys(elements)).filter(c => c in elements && !elements[c].virtual && !elements[c].isAssociation
    )
    this.sql = `INSERT INTO ${entity}${alias ? ' as ' + this.quote(alias) : ''} (${columns}) ${this.SELECT(cqn4sql(INSERT.as))}`
    this.entries = [this.values]
    return this.sql
  }

  output_converter4(element,expr) {
    const fn = element?.[this.class._convertOutput]
    return fn?.(expr,element) || expr
  }

  static InputConverters = {} // subclasses to override

  static OutputConverters = {} // subclasses to override

  static localized = { String: true, UUID: false }


  // UPSERT Statements ------------------------------------------------


  UPSERT(q) {
    let { UPSERT } = q, sql = this.INSERT ({__proto__:q, INSERT:UPSERT })
    let keys = q.target?.keys; if (!keys) return this.sql = sql // REVISIT: We should converge q.target and q._target
    keys = Object.keys(keys).filter(k => !keys[k].isAssociation)

    let updateColumns = q.UPSERT.entries ? Object.keys(q.UPSERT.entries[0]) : this.columns
    updateColumns = updateColumns.filter(c => !keys.includes(c)).map (c => `${this.quote(c)} = excluded.${this.quote(c)}`)

    keys = keys.map(k => this.quote(k))
    const conflict = updateColumns.length
    ? ` ON CONFLICT(${ keys }) DO UPDATE SET ` + updateColumns
    : ` ON CONFLICT(${ keys }) DO NOTHING`
    return this.sql = `${sql} WHERE true ${conflict}`
  }


  // UPDATE Statements ------------------------------------------------


  UPDATE(q) {
    const { UPDATE: { entity, with:_with, data, where } } = q, elements = q.target?.elements
    let sql = `UPDATE ${this.name(entity.ref?.[0] || entity)}`
    if (entity.as) sql += ` AS ${entity.as}`
    let columns = []
    if (data) for (let c in data) if (!elements || c in elements && !elements[c].virtual) {
      columns.push({ name:c, sql: this.val({val:data[c]}) })
    }
    if (_with) for (let c in _with) if (!elements || c in elements && !elements[c].virtual) {
      columns.push({ name:c, sql: this.expr(_with[c]) })
    }

    columns = columns.map(c => {
      if(q.elements?.[c.name]?.['@cds.extension']){
        return {
          name: 'extensions__',
          sql: `json_set(extensions__,${this.string('$.' + c.name)},${c.sql})`
        }
      }
      return c
    })

    const extraction = this.managed(columns, q.elements, true).map(c => `${this.quote(c.name)}=${c.sql}`)

    sql += ` SET ${extraction}`
    if (where) sql += ` WHERE ${this.where(where)}`
    return this.sql = sql
  }


  // DELETE Statements ------------------------------------------------


  DELETE({ DELETE: { from, where } }) {
    let sql = `DELETE FROM ${this.from(from)}`
    if (where) sql += ` WHERE ${this.where(where)}`
    return this.sql = sql
  }


  // Expression Clauses ---------------------------------------------


  expr(x) {
    const wrap = x.cast ? sql => `cast(${sql} as ${this.type4(x.cast)})` : sql => sql
    if (typeof x === 'string') throw cds.error`Unsupported expr: ${x}`
    if ('param' in x)  return wrap(this.param(x))
    if ('ref' in x)    return wrap(this.ref(x))
    if ('val' in x)    return wrap(this.val(x))
    if ('xpr' in x)    return wrap(this.xpr(x))
    if ('func' in x)   return wrap(this.func(x))
    if ('list' in x)   return wrap(this.list(x))
    if ('SELECT' in x) return wrap(`(${this.SELECT(x)})`)
    else throw cds.error`Unsupported expr: ${x}`
  }

  xpr({ xpr }) {
    return xpr.map((x,i) => {
      if (x in {LIKE:1,like:1} && is_regexp(xpr[i+1]?.val)) return this.operator('regexp')
      if (typeof x === 'string') return this.operator(x,i,xpr)
      if (x.xpr) return `(${this.xpr(x)})`
      else return this.expr(x)
    }).join(' ')
  }

  operator (x,i,xpr) {
    if (x === '=' && xpr[i+1]?.val === null) return 'is'
    if (x === '!=') return 'is not'
    else return x
  }

  param({ ref }) {
    if (ref.length > 1) throw cds.error `Unsupported nested ref parameter: ${ref}`
    return ref[0] === '?' ? '?' : `:${ref}`
  }

  ref({ ref }) {
    return ref.map(r => this.quote(r)).join('.')
  }

  val({ val }) {
    switch (typeof val) {
      case 'function':  throw new Error('Function values not supported.')
      case 'undefined': return 'NULL'
      case 'boolean':   return val
      case 'number':    return val // REVISIT for HANA
      case 'object':
        if (val === null) return 'NULL'
        if (val instanceof Date) return `'${val.toISOString()}'`
        if (Buffer.isBuffer(val)) val = val.toString('base64')
        else val = this.regex(val) || this.json(val)
    }
    if(!this.values) return this.string(val)
    this.values.push(val)
    return '?'
  }

  static Functions = require('./func')
  func({ func, args }) {
    args = (args||[]).map(e => e === '*' ? e : { __proto__:e, toString:(x=e)=>this.expr(x) })
    return this.class.Functions[func]?.apply(this.class.Functions, args) || `${func}(${args})`
  }

  list({ list }) {
    return `(${list.map(e => this.expr(e))})`
  }

  regex(o) {
    if (is_regexp(o)) return o.source
  }

  json(o) {
    return this.string(JSON.stringify(o))
  }

  string(s) {
    return `'${s.replace(/'/g, "''")}'`
  }

  column_name(col) {
    return (typeof col.as === 'string' && col.as) || ('val' in col && col.val + '') || col.ref[col.ref.length - 1]
  }

  name(name) {
    return (name.id || name).replace(/\./g, '_')
  }

  static ReservedWords = {}
  quote(s) {
    if (typeof s !== 'string') return '"'+s+'"'
    if (s.includes('"')) return '"'+s.replace(/"/g,'""')+'"'
    if (s.toUpperCase() in this.class.ReservedWords || /^\d|[$' /\\]/.test(s)) return '"'+s+'"'
    return s
  }

  managed(columns, elements, isUpdate = false) {
    const annotation = isUpdate ? '@cds.on.update' : '@cds.on.insert'
    const inputConverterKey = this.class._convertInput
    // Ensure that missing managed columns are added
    const requiredColumns = !elements ? [] : Object.keys(elements)
      .filter(e => (elements[e]?.[annotation] || (!isUpdate && elements[e]?.default && !elements[e].virtual)) && !columns.find(c => c.name === e))
      .map(name => ({name,sql:'NULL'}))

    return [...columns,...requiredColumns].map(({name,sql}) => {
      const element = elements?.[name] || {}
      let extract = sql ?? `value->>'$.${name}'`
      const converter = element[inputConverterKey] || (e => e)
      let managed = element[annotation]?.['=']
      switch (managed) {
        case '$user.id':
        case '$user':
          managed = this.string(this.context.user.id)
          break
        case '$now':
          // REVISIT fix for date precision
          managed = this.string(this.context.timestamp.toISOString())
          break
        default:
          managed = undefined
      }
      if(!isUpdate) {
        const d = element.default
        if(d && (d.val !== undefined || d.ref?.[0] === '$now')) {
          extract = `(CASE WHEN json_type(value,'$.${name}') IS NULL THEN ${this.defaultValue(d.val)} ELSE ${extract} END)`
        }
      }
      return {
        name,
        sql:converter(managed === undefined ? extract : `coalesce(${extract}, ${managed})`, element)
      }
    })
  }

  defaultValue(defaultValue = (this.context.timestamp).toISOString()) {
    return typeof defaultValue === 'string' ? this.string(defaultValue) : defaultValue
  }
}

// REVISIT: Workaround for JSON.stringify to work with buffers
Buffer.prototype.toJSON = function() { return this.toString('base64') }

const ObjectKeys = o => (o && [...ObjectKeys(o.__proto__), ...Object.keys(o)] || [])
const has_expands = q => q.SELECT.columns?.some(c => c.SELECT?.expand)
const has_arrays = q => q.elements && Object.values(q.elements).some(e => e.items)

const is_regexp = x => x?.constructor?.name === 'RegExp' // NOTE: x instanceof RegExp doesn't work in repl
const _empty = a => !a || a.length === 0
module.exports = Object.assign((q,m) => (new CQN2SQLRenderer).render(cqn4sql(q,m),m), { class: CQN2SQLRenderer })
