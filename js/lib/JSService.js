const cds = require('../../../cds'),
  DEBUG = cds.debug('sql|db')
const DatabaseService = require('@cap-js/db-service/lib/common/DatabaseService')
const cqn4sql = require('@cap-js/db-service/lib/cqn4sql')

// Helpers
// Data generation
const manage = require('@cap-js/db-service/lib/helpers/managed')

// Data processing
const one = require('@cap-js/db-service/lib/helpers/one')
const limit = require('@cap-js/db-service/lib/helpers/limit')
const count = require('@cap-js/db-service/lib/helpers/count')
const orderBy = require('@cap-js/db-service/lib/helpers/orderBy')
const having = require('@cap-js/db-service/lib/helpers/having')
const groupBy = require('@cap-js/db-service/lib/helpers/groupBy')
const where = require('@cap-js/db-service/lib/helpers/where')
const computed = require('@cap-js/db-service/lib/helpers/computed')
const join = require('@cap-js/db-service/lib/helpers/join')
const projection = require('@cap-js/db-service/lib/helpers/projection')
const schema = require('@cap-js/db-service/lib/helpers/schema')

const drivers = require('./driver')

class JSService extends DatabaseService {
  init() {
    this.on(['*'], (req, next) => {
      return next()
    })

    manage(this)

    one(this)
    limit(this)
    count(this)
    orderBy(this)
    having(this)
    groupBy(this)
    where(this)
    computed(this)
    join(this)
    projection(this)
    schema(this, {
      InputConverters: this.constructor.InputConverters,
      OutputConverters: this.constructor.OutputConverters
    })

    this.on(['SELECT'], this.onSELECT)
    this.on(['INSERT'], this.onINSERT)
    this.on(['UPSERT'], this.onUPSERT)
    this.on(['UPDATE'], this.onUPDATE)
    this.on(['DELETE'], this.onDELETE)
    this.on(['CREATE ENTITY'], this.onCREATE)
    this.on(['DROP ENTITY'], this.onDROP)
    this.on(['BEGIN', 'COMMIT', 'ROLLBACK'], this.onEVENT)
    this.on(['*'], this.onPlainSQL)
    this.kind = 'js'

    return super.init()
  }

  get factory() {
    return {
      options: { min: 1, ...this.options.pool },
      create: tenant => {
        const Driver = drivers[this.options?.driver] || drivers.default
        return new Driver(tenant)
      },
      destroy: dbc => dbc.destroy(),
      validate: dbc => dbc.validate()
    }
  }

  /** Handler for SELECT */
  async onSELECT({ query }) {
    const cqn = this.cqn4sql(query)
    return this.dbc.SELECT(cqn, true)
  }

  async onINSERT({ query, data }) {
    const cqn = this.cqn4sql(query)
    return this.dbc.INSERT(cqn, data)
  }

  async onUPSERT(/*{ query, data }*/) {}

  async onUPDATE({ query }) {
    const cqn = this.cqn4sql(query)
    return this.dbc.UPDATE(cqn)
  }

  async onDELETE({ query }) {
    const cqn = this.cqn4sql(query)
    return this.dbc.DELETE(cqn)
  }

  async onCREATE({ query }) {
    const name = query.CREATE.entity
    const definition = this.model.definitions[name]

    // const isView = definition.query || definition.projection
    /*
    if (isView) {
      // Don't deploy views to the database rely on the projection helper instead
      return
    }
    */

    const elements = ObjectKeys(definition.elements).reduce((l, c) => {
      const element = definition.elements[c]
      if (!(element.virtual || element.isAssociation)) {
        l[c] = {
          name: c,
          type: element.type || (element.items ? 'cds.Array' : 'cds.Struct'),
          mandatory: element._isMandatory,
          precision: element.precision,
          scale: element.scale,
          length: element.length
        }
      }
      return l
    }, {})
    this.dbc.CREATE_TABLE(name, elements)
  }

  async onDROP({ query }) {
    const name = query.DROP.target
    this.dbc.DROP(name)
  }

  /** Handler for BEGIN, COMMIT, ROLLBACK, which don't have any CQN */
  async onEVENT({ event }) {
    DEBUG?.(event) // in the other cases above DEBUG happens in cqn2sql
  }

  /** Handler for SQL statements which don't have any CQN */
  async onPlainSQL({ query }) {
    // REVISIT: Should not be needed when deployment supports all types or sends CQNs
    // Rewrite drop statements
    if (/^DROP TABLE/i.test(query)) {
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
    if (/^CREATE TABLE/i.test(query)) {
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

    if (/^(CREATE|DROP) VIEW/.test(query)) {
      return
    }

    cds.error`This is not a SQL data base: ${query}`
  }

  set(/*variables*/) {}

  cqn4sql(q) {
    if (q.__normalized__ || (q.SELECT?.from.args && !q.SELECT.columns)) return q
    const cqn = cqn4sql(q, this.model)
    Object.defineProperty(cqn, '__normalized__', { value: true, configurable: true, writable: true })
    return cqn
  }

  static InputConverters = {
    // Globals
    'cds.Boolean': (x, e) => (typeof x === 'boolean' ? x : x == null || x === 'null' ? null : invalid(x, e)),

    // Numbers
    'cds.Int16': (x, e) =>
      typeof x === 'number' ? x : typeof x === 'string' ? Number.parseInt(x, 10) : x == null ? null : invalid(x, e),
    'cds.Integer': (x, e) =>
      typeof x === 'number' ? x : typeof x === 'string' ? Number.parseInt(x, 10) : x == null ? null : invalid(x, e),
    'cds.Integer64': (x, e) =>
      typeof x === 'bigint' ? x : typeof x === 'string' ? BigInt(x) : x == null ? null : invalid(x, e),
    'cds.Double': (x, e) =>
      typeof x === 'number' ? x : typeof x === 'string' ? Number.parseFloat(x, 10) : x == null ? null : invalid(x, e),
    'cds.Float': (x, e) =>
      typeof x === 'number' ? x : typeof x === 'string' ? Number.parseFloat(x, 10) : x == null ? null : invalid(x, e),
    'cds.Decimal': (x, e) =>
      typeof x === 'number' ? x : typeof x === 'string' ? Number.parseFloat(x, 10) : x == null ? null : invalid(x, e),

    // Strings
    'cds.String': (x, e) => (typeof x === 'string' ? x : x == null ? null : invalid(x, e)),
    'cds.LargeString': (x, e) => (typeof x === 'string' ? x : x == null ? null : invalid(x, e)),
    'cds.LargeBinary': (x, e) => (typeof x === 'string' ? x : x == null ? null : invalid(x, e)),

    // Date time types
    'cds.Date': (x, e) =>
      x instanceof Date
        ? x.toISOString()
        : typeof x === 'string'
        ? new Date(x).toISOString()
        : x == null
        ? null
        : invalid(x, e),
    'cds.Time': (x, e) =>
      x instanceof Date
        ? x.toISOString()
        : typeof x === 'string'
        ? new Date('1970-01-01T' + x + 'Z').toISOString()
        : x == null
        ? null
        : invalid(x, e),
    'cds.DateTime': (x, e) => {
      if (x instanceof Date) return x.toISOString()
      if (typeof x === 'string') {
        if (x.indexOf(/\+|-|Z/) < 0) {
          x += 'Z'
        }
        x = x.replace(' ', 'T')
        return new Date(x).toISOString()
      }
      if (x == null || x === 'null') {
        return null
      }
      invalid(x, e)
    },
    'cds.Timestamp': (x, e) => {
      if (x instanceof Date) return x.toISOString()
      if (typeof x === 'string') {
        if (x.indexOf(/\+|-|Z/) < 0) {
          x += 'Z'
        }
        x = x.replace(' ', 'T')
        return new Date(x).toISOString()
      }
      if (x == null || x === 'null') {
        return null
      }
      invalid(x, e)
    },
    // Structured
    'cds.Array': (x, e) => (typeof x === 'string' ? JSON.parse(x) : x == null ? null : invalid(x, e))
  }

  static OutputConverters = {
    // Globals
    // 'cds.Boolean': echo,

    // Numbers
    // 'cds.Integer': echo,
    // 'cds.Integer64': echo,
    // 'cds.Double': echo, // TODO: precision
    // 'cds.Float': echo,
    // 'cds.Decimal': echo,

    // Strings
    // 'cds.String': echo,
    // 'cds.LargeString': echo,

    // Date time types
    'cds.Date': v => (v == null ? null : new Date(v).toISOString().slice(0, 10)),
    'cds.Time': v => (v == null ? null : new Date(v).toISOString().slice(11, 19)),
    'cds.DateTime': v => (v == null ? null : new Date(v).toISOString().slice(0, 19) + 'Z'),
    'cds.Timestamp': v => (v == null ? null : new Date(v).toISOString())
  }
}

const invalid = (x, e) => cds.error`Invalid data ${JSON.stringify(x)} for type ${JSON.stringify(e.type)}`
const ObjectKeys = o => (o && [...ObjectKeys(o.__proto__), ...Object.keys(o)]) || []

module.exports = JSService
