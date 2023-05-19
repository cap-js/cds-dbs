const cds = require('@sap/cds')

const schema = {}
const data = {}

module.exports = class JSMemoryDriver {
  constructor(tenant) {
    this.tenant = tenant

    // The data
    this.data = data
    // The structure definition of the data
    this.schema = schema
  }

  destroy() {}

  validate() {
    return true
  }

  SELECT(query) {
    const { from } = query.SELECT

    let data

    if (from.ref?.length === 1) {
      const name = this.name(from.ref[0])
      // Copy data array once for in array manipulations
      data = this.data[name].slice()
    } else {
      cds.error`UNKNOWN QUERY SOURCE ${JSON.stringify(from)}`
    }

    // Copy data objects to prevent outside manipulation
    /*for(let i = 0; i < data.length; i++) {
      data[i] = {...data[i]}
    }*/

    return data
  }

  INSERT(query, data) {
    const name = this.name(query.target?.name || query.INSERT.into?.ref?.[0])
    const schema = this.schema[name]

    data = query.INSERT.rows
      ? query.INSERT.rows.map(r =>
          query.INSERT.columns.reduce((l, c, i) => {
            l[c] = r[i]
            return l
          }, {})
        )
      : query.INSERT.entries
      ? query.INSERT.entries
      : data
      ? Array.isArray(data)
        ? data
        : [data]
      : []

    console.log(name, data.length)
    schema.insert.entries(this.data[name], data)
    return data.length
  }

  UPDATE(query) {
    const { entity, entry, data } = query.UPDATE

    const name = this.name(query.target?.name || entity?.ref?.[0])

    const index = this.indexOf(name, entry)
    if (index < 0) return 0

    const row = this.data[name][index]

    const changes = Object.getOwnPropertyNames(data)
    for (let i = 0; i < changes.length; i++) {
      const prop = changes[i]
      if (prop in row) {
        row[prop] = data[prop]
      }
    }

    return 1
  }

  DELETE(query) {
    const name = this.name(query.target?.name || query.DELETE.from?.ref?.[0])
    const data = this.data[name]

    const index = this.indexOf(name, query.DELETE.entry)
    if (index < 0) return 0
    data.splice(index, 1)
    return 1
  }

  CREATE_TABLE(name, elements) {
    const insert = {}

    let inputConverters = ''
    const columns = Object.keys(elements)
    for (let i = 0; i < columns.length; i++) {
      const c = columns[i]
      inputConverters += typesInput[elements[c].type]?.(elements[c]) || cds.error(`Unknown type "${elements[c].type}"`)
      inputConverters += '\n'
    }

    const entries = `
      let x
      for(var i = 0; i < entries.length; i++) {
        const row = entries[i]
        ${inputConverters}
        data.push(row)
      }
      return data`
    insert.entries = new Function('data', 'entries', entries)

    name = this.name(name)
    this.schema[name] = { elements, insert }
    this.data[name] = this.data[name] || []
  }

  DROP(name) {
    delete this.schema[name]
    delete this.data[name]
  }

  name(name) {
    return name.replace(/\./g, '_')
  }

  indexOf(name, entry) {
    const schema = this.schema[name]
    const data = this.data[name]

    const entries = []
    // Normalize entry to database storage
    schema.insert.entries(entries, [entry])

    entry = entries[0]
    root: for (let i = 0; i < data.length; i++) {
      const row = data[i]
      const keys = Object.keys(row)
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        if (
          (typeof row[key] === 'object' && `${entry[key]}` !== `${row[key]}`) ||
          (typeof row[key] !== 'object' && entry[key] !== row[key])
        ) {
          continue root
        }
      }
      return i
    }
  }
}

const typeAssign = e => `x = row[${JSON.stringify(e.name)}]; row[${JSON.stringify(e.name)}]`
const invalid = e => `cds.error('Invalid data ' + i + ' ${JSON.stringify(e.name)}')`
// TODO: move to schema.js
const typesInput = {
  // Globals
  'cds.Boolean': e =>
    `${typeAssign(e)} = typeof x === 'boolean' ? x : x == null || x === 'null' ? null : ${invalid(e)}`,

  // Numbers
  'cds.Int16': e =>
    `${typeAssign(
      e
    )} = typeof x === 'number' ? x : typeof x === 'string' ? Number.parseInt(x,10) : x == null ? null : ${invalid(e)}`,
  'cds.Integer': e =>
    `${typeAssign(
      e
    )} = typeof x === 'number' ? x : typeof x === 'string' ? Number.parseInt(x,10) : x == null ? null : ${invalid(e)}`,
  'cds.Integer64': e =>
    `${typeAssign(e)} = typeof x === 'bigint' ? x : typeof x === 'string' ? BigInt(x) : x == null ? null : ${invalid(
      e
    )}`,
  'cds.Double': e =>
    `${typeAssign(
      e
    )} = typeof x === 'number' ? x : typeof x === 'string' ? Number.parseFloat(x,10) : x == null ? null : ${invalid(
      e
    )}`,
  'cds.Float': e =>
    `${typeAssign(
      e
    )} = typeof x === 'number' ? x : typeof x === 'string' ? Number.parseFloat(x,10) : x == null ? null : ${invalid(
      e
    )}`,
  'cds.Decimal': e =>
    `${typeAssign(
      e
    )} = typeof x === 'number' ? x : typeof x === 'string' ? Number.parseFloat(x,10) : x == null ? null : ${invalid(
      e
    )}`,

  // Strings
  'cds.String': e => `${typeAssign(e)} = typeof x === 'string' ? x : x == null ? null : ${invalid(e)}`,
  'cds.UUID': e => `${typeAssign(e)} = typeof x === 'string' ? x : x == null ? null : ${invalid(e)}`,
  'cds.LargeString': e => `${typeAssign(e)} = typeof x === 'string' ? x : x == null ? null : ${invalid(e)}`,
  'cds.LargeBinary': e => `${typeAssign(e)} = typeof x === 'string' ? x : x == null ? null : ${invalid(e)}`,

  // Date time types
  'cds.Date': e =>
    `${typeAssign(e)} = x instanceof Date ? x.toISOString() : typeof x === 'string' ? new Date(x).toISOString() : x == null ? null : ${invalid(
      e
    )}`,
  'cds.Time': e =>
    `${typeAssign(
      e
    )} = x instanceof Date ? x.toISOString() : typeof x === 'string' ? new Date('1970-01-01T' + x + 'Z').toISOString() : x == null ? null : ${invalid(
      e
    )}`,
  'cds.DateTime': e =>
    `${typeAssign(e)} = x instanceof Date ? x.toISOString() : typeof x === 'string' ? new Date(x).toISOString() : x == null ? null : ${invalid(
      e
    )}`,
  'cds.Timestamp': e =>
    `${typeAssign(e)} = x instanceof Date ? x.toISOString() : typeof x === 'string' ? new Date(x).toISOString() : x == null ? null : ${invalid(
      e
    )}`,

  // Structured
  'cds.Array': e => `${typeAssign(e)} = typeof x === 'string' ? JSON.parse(x) : x == null ? null : ${invalid(e)}`
}
