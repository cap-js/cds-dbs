const cds = require('@sap/cds')

const CQN2SQL = require('./cqn2sql.js').class

class CQN2PQLRenderer extends CQN2SQL {

  SELECT(q) {
    this.values = undefined // inline all values
    return (this.sql = super.SELECT(q)
      .replaceAll('\n FROM', '\nFROM')
      .replaceAll(/([^ ]) (FROM|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT) /g, (a, b, c) => `${b}\n${c} `)
    )
  }

  SELECT_columns(q) {
    return super.SELECT_columns(q).map((c, i) => `${(i % 5 === 0) ? '\n  ' : ' '}${c}${/ as /i.test(c) ? '\n' : ''}`).join(',')
  }

  column_expr(x, q) {
    // omit alias when target is a single source
    if (q.SELECT.from.ref && x?.ref) x.ref = x.ref.slice(-1)
    return super.column_expr(x, q)
  }

  SELECT_expand(q, sql) { return sql }

  INSERT_entries(q) {
    super.INSERT_entries(q)
    this.sql = this.sql
      .replaceAll(/AS (.*?)([, ])(?=[^\n])/ig, (a, b, c) => `AS ${b}${c}\n${c === ',' ? ' ' : ''}`)
      .replaceAll(/ *= */ig, ' = ')
      .replaceAll('value AS "$$value$$"', 'value')
      .replaceAll(' WHERE ', '\nWHERE ')
      .replaceAll(' SELECT ', '\nSELECT')
      .replaceAll('(SELECT ', '(SELECT\n  ')
      .replaceAll('))', ')\n)')
  }

  INSERT_rows(q) {
    super.INSERT_rows(q)
    this.sql = this.sql.replaceAll('SELECT', '\nSELECT')
  }

  UPSERT(q) {
    super.UPSERT(q)
    this.sql = this.sql
      .replaceAll('INSERT', 'UPSERT')
      .replaceAll(/AS (.*?)([, ])(?=[^\n])/ig, (a, b, c) => `AS ${b}${c}\n${c === ',' ? ' ' : ''}`)
      .replaceAll(/ *= */ig, ' = ')
      .replaceAll('value AS "$$value$$"', 'value')
      .replaceAll(' WHERE ', '\nWHERE ')
      .replaceAll(' SELECT ', '\nSELECT')
      .replaceAll('(SELECT ', '(SELECT\n  ')
      .replaceAll('))', ')\n)')
  }

  expr(x) {
    const wrap = x.cast ? sql => `cast(${sql} as ${this.type4(x.cast)})` : sql => sql
    if (typeof x === 'string') throw cds.error`Unsupported expr: ${x}`
    if (x.param) return wrap(this.param(x))
    if ('ref' in x) return wrap(this.ref(x))
    if ('val' in x) return wrap(this.val(x))
    if ('func' in x) return wrap(this.func(x))
    if ('xpr' in x) return wrap(this.xpr(x))
    if ('list' in x) return wrap(this.list(x))
    if ('SELECT' in x) return wrap(`(\n    ${this.SELECT(x).replaceAll('\n', '\n    ')}\n  )`)
    else throw cds.error`Unsupported expr: ${x}`
  }

  quote(s) { return s }

  managed(columns, elements) {
    const keys = ObjectKeys(elements).filter(e => elements[e].key && !elements[e].isAssociation)
    const keyZero = keys[0]

    const ret = super.managed(columns, elements)

    ret.forEach(c => {
      const { name, insert, update, onInsert, onUpdate } = c
      const element = elements?.[name]
      c.upsert = keyZero && (
        // upsert requires the keys to be provided for the existance join (default values optional)
        element?.key
          // If both insert and update have the same managed definition exclude the old value check
          || (onInsert && onUpdate && insert === update)
          ? `${insert} as ${name}`
          : `!OLD.${keyZero} ? ${
          // If key of old is null execute insert
          insert
          } : ${
          // Else execute managed update or keep old if no new data if provided
          onUpdate ? update : `(${this.managed_default(name, `OLD.${name}`, update)})`
          } as ${name}`
      )
      if (c.upsert) c.upsert = '\n  ' + c.upsert
    })
    return ret
  }

  managed_default(name, managed, src) {
    return `!${src} ? ${managed} : ${src}`
  }

  managed_extract(name) {
    const { UPSERT, INSERT } = this.cqn
    const extract = !(INSERT?.entries || UPSERT?.entries) && (INSERT?.rows || UPSERT?.rows)
      ? `value[${this.columns.indexOf(name)}]`
      : `value[${JSON.stringify(name)}]`
    const sql = extract
    return { extract, sql }
  }
}

const ObjectKeys = o => (o && [...ObjectKeys(o.__proto__), ...Object.keys(o)]) || []

module.exports = CQN2PQLRenderer
