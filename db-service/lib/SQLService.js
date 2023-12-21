const cds = require('@sap/cds/lib'),
  DEBUG = cds.debug('sql|db')
const { resolveView } = require('@sap/cds/libx/_runtime/common/utils/resolveView')
const DatabaseService = require('./common/DatabaseService')
const cqn4sql = require('./cqn4sql')

/** @typedef {import('@sap/cds/apis/services').Request} Request */

/**
 * @callback Handler
 * @param {Request} req
 * @param {(err? : Error) => {Promise<unknown>}} next
 * @returns {Promise<unknown>}
 */

class SQLService extends DatabaseService {

  init() {
    this.on(['SELECT'], this.transformStreamFromCQN)
    this.on(['UPDATE'], this.transformStreamIntoCQN)
    this.on(['INSERT', 'UPSERT', 'UPDATE'], require('./fill-in-keys')) // REVISIT: should be replaced by correct input processing eventually
    this.on(['INSERT', 'UPSERT', 'UPDATE'], require('./deep-queries').onDeep)
    this.on(['SELECT'], this.onSELECT)
    this.on(['INSERT'], this.onINSERT)
    this.on(['UPSERT'], this.onUPSERT)
    this.on(['UPDATE'], this.onUPDATE)
    this.on(['DELETE'], this.onDELETE)
    this.on(['CREATE ENTITY', 'DROP ENTITY'], this.onSIMPLE)
    this.on(['BEGIN', 'COMMIT', 'ROLLBACK'], this.onEVENT)
    this.on(['STREAM'], this.onSTREAM)
    this.on(['*'], this.onPlainSQL)
    return super.init()
  }

  /** @type {Handler} */
  async transformStreamFromCQN({ query }, next) {
    if (!query._streaming) return next()
    const cqn = STREAM.from(query.SELECT.from).column(query.SELECT.columns[0].ref[0])
    if (query.SELECT.where) cqn.STREAM.where = query.SELECT.where
    const stream = await this.run(cqn)
    return stream && { value: stream }
  }

  /** @type {Handler} */
  async transformStreamIntoCQN({ query, data, target }, next) {
    let col, type, etag
    const elements = query._target?.elements || target?.elements
    if (!elements) next()
    for (const key in elements) {
      const element = elements[key]
      if (element['@Core.MediaType'] && data[key]?.pipe) col = key
      if (element['@Core.IsMediaType'] && data[key]) type = key
      if (element['@odata.etag'] && data[key]) etag = key
    }

    if (!col) return next()

    const cqn = STREAM.into(query.UPDATE.entity).column(col).data(data[col])
    if (query.UPDATE.where) cqn.STREAM.where = query.UPDATE.where
    const result = await this.run(cqn)
    if (type || etag) {
      const d = { ...data }
      delete d[col]
      const cqn = UPDATE.entity(query.UPDATE.entity).with(d)
      if (query.UPDATE.where) cqn.UPDATE.where = query.UPDATE.where
      await this.run(cqn)
    }

    return result
  }

  /**
   * Handler for SELECT
   * @type {Handler}
   */
  async onSELECT({ query, data }) {
    const { sql, values, cqn } = this.cqn2sql(query, data)
    let ps = await this.prepare(sql)
    let rows = await ps.all(values)
    if (rows.length)
      if (cqn.SELECT.expand) rows = rows.map(r => (typeof r._json_ === 'string' ? JSON.parse(r._json_) : r._json_ || r))
    if (cqn.SELECT.count) {
      // REVISIT: the runtime always expects that the count is preserved with .map, required for renaming in mocks
      return SQLService._arrayWithCount(rows, await this.count(query, rows))
    }
    return cqn.SELECT.one || query.SELECT.from?.ref?.[0].cardinality?.max === 1 ? rows[0] : rows
  }

  /**
   * Handler for INSERT
   * @type {Handler}
   */
  async onINSERT({ query, data }) {
    const { sql, entries, cqn } = this.cqn2sql(query, data)
    if (!sql) return // Do nothing when there is nothing to be done // REVISIT: fix within mtxs
    const ps = await this.prepare(sql)
    const results = entries ? await Promise.all(entries.map(e => ps.run(e))) : await ps.run()
    return new this.class.InsertResults(cqn, results)
  }

  /**
   * Handler for UPSERT
   * @type {Handler}
   */
  async onUPSERT({ query, data }) {
    const { sql, entries } = this.cqn2sql(query, data)
    if (!sql) return // Do nothing when there is nothing to be done // REVISIT: When does this happen?
    const ps = await this.prepare(sql)
    const results = entries ? await Promise.all(entries.map(e => ps.run(e))) : await ps.run()
    // REVISIT: results isn't an array, when no entries -> how could that work? when do we have no entries?
    return results.reduce((total, affectedRows) => (total += affectedRows.changes), 0)
  }

  /**
   * Handler for UPDATE
   * @type {Handler}
   */
  async onUPDATE(req) {
    // noop if not a touch for @cds.on.update
    if (
      !req.query.UPDATE.data &&
      !req.query.UPDATE.with &&
      !Object.values(req.target?.elements || {}).some(e => e['@cds.on.update'])
    )
      return 0
    return this.onSIMPLE(req)
  }

  /**
   * Handler for Stream
   * @type {Handler}
   */
  async onSTREAM(req) {
    const { one, sql, values } = this.cqn2sql(req.query)
    // writing stream
    if (req.query.STREAM.into) {
      const ps = await this.prepare(sql)
      return (await ps.run(values)).changes
    }
    // reading stream
    const ps = await this.prepare(sql)
    return ps.stream(values, one)
  }

  /**
   * Handler for CREATE, DROP, UPDATE, DELETE, with simple CQN
   * @type {Handler}
   */
  async onSIMPLE({ query, data }) {
    const { sql, values } = this.cqn2sql(query, data)
    let ps = await this.prepare(sql)
    return (await ps.run(values)).changes
  }

  get onDELETE() {
    // REVISIT: It's not yet 100 % clear under which circumstances we can rely on db constraints
    return super.onDELETE = /* cds.env.features.assert_integrity === 'db' ? this.onSIMPLE : */ deep_delete
    async function deep_delete(/** @type {Request} */ req) {
      let { compositions } = req.target
      if (compositions) {
        // Transform CQL`DELETE from Foo[p1] WHERE p2` into CQL`DELETE from Foo[p1 and p2]`
        let { from, where } = req.query.DELETE
        if (typeof from === 'string') from = { ref: [from] }
        if (where) {
          let last = from.ref.at(-1)
          if (last.where) [ last, where ] = [ last.id, [ { xpr: last.where }, 'and', { xpr: where } ] ]
          from = {ref:[ ...from.ref.slice(0,-1), { id: last, where }]}
        }
        // Process child compositions depth-first
        let { depth=0, visited=[] } = req
        visited.push (req.target.name)
        await Promise.all (Object.values(compositions).map(c => {
          if (c._target['@cds.persistence.skip'] === true) return
          if (c._target === req.target) { // the Genre.children case
            if (++depth > (c['@depth'] || 3)) return
          } else if (visited.includes(c._target.name)) throw new Error(
            `Transitive circular composition detected: \n\n`+
            `  ${visited.join(' > ')} > ${c._target.name} \n\n`+
            `These are not supported by deep delete.`)
          // Prepare and run deep query, à la CQL`DELETE from Foo[pred]:comp1.comp2...`
          const query = DELETE.from({ref:[ ...from.ref, c.name ]})
          return this.onDELETE({ query, depth, visited: [...visited], target: c._target })
        }))
      }
      return this.onSIMPLE(req)
    }
  }

  /**
   * Handler for BEGIN, COMMIT, ROLLBACK, which don't have any CQN
   * @type {Handler}
   */
  async onEVENT({ event }) {
    DEBUG?.(event) // in the other cases above DEBUG happens in cqn2sql
    return await this.exec(event)
  }

  /**
   * Handler for SQL statements which don't have any CQN
   * @type {Handler}
   */
  async onPlainSQL({ query, data }, next) {
    if (typeof query === 'string') {
      DEBUG?.(query, data)
      const ps = await this.prepare(query)
      const exec = this.hasResults(query) ? d => ps.all(d) : d => ps.run(d)
      if (Array.isArray(data) && typeof data[0] === 'object') return await Promise.all(data.map(exec))
      else return exec(data)
    } else return next()
  }

  /**
   *  Override in subclasses to detect more statements to be called with ps.all()
   * @param {string} sql
   */
  hasResults(sql) {
    return /^(SELECT|WITH|CALL|PRAGMA table_info)/i.test(sql)
  }

  /**
   * Derives and executes a query to fill in `$count` for given query
   * @param {import('@sap/cds/apis/cqn').SELECT} query - SELECT CQN
   * @param {unknown[]} ret - Results of the original query
   * @returns {Promise<number>}
   */
  async count(query, ret) {
    if (ret) {
      const { one, limit: _ } = query.SELECT,
        n = ret.length
      const [max, offset = 0] = one ? [1] : _ ? [_.rows?.val, _.offset?.val] : []
      if (max === undefined || (n < max && (n || !offset))) return n + offset
    }
    // REVISIT: made uppercase count because of HANA reserved word quoting
    const cq = SELECT.one([{ func: 'count', as: 'COUNT' }]).from(
      cds.ql.clone(query, {
      localized: false,
      expand: false,
        limit: undefined,
        orderBy: undefined,
      }),
    )
    const { count, COUNT } = await this.onSELECT({ query: cq })
    return count ?? COUNT
  }

  /**
   * Helper class for results of INSERTs.
   * Subclasses may override this.
   */
  static InsertResults = require('./InsertResults')

  /**
   * Helper class implementing {@link SQLService#cqn2sql}.
   * Subclasses commonly override this.
   */
  static CQN2SQL = require('./cqn2sql').class

  // REVISIT: There must be a better way!
  // preserves $count for .map calls on array
  static _arrayWithCount = function (a, count) {
    const _map = a.map
    const map = function (..._) { return SQLService._arrayWithCount(_map.call(a, ..._), count) }
    return Object.defineProperties(a, {
      $count: { value: count, enumerable: false, configurable: true, writable: true },
      map: { value: map, enumerable: false, configurable: true, writable: true }
    })
  }

  /** @param {unknown[]} args */
  constructor(...args) {
    super(...args)
    /** @type {unknown} */
    this.class = new.target // for IntelliSense
  }

  /**
   * @param {import('@sap/cds/apis/cqn').Query} query
   * @param {unknown} values
   * @returns {typeof SQLService.CQN2SQL}
   */
  cqn2sql(query, values) {
    let q = this.cqn4sql(query)
    if (q.SELECT && 'elements' in q) q.SELECT.expand ??= 'root'

    let kind = q.kind || Object.keys(q)[0]
    if (kind in { INSERT: 1, DELETE: 1, UPSERT: 1, UPDATE: 1 } || q.STREAM?.into) {
      q = resolveView(q, this.model, this) // REVISIT: before resolveView was called on flat cqn obtained from cqn4sql -> is it correct to call on original q instead?
      let target = q[kind]._transitions?.[0].target
      if (target) q.target = target // REVISIT: Why isn't that done in resolveView?
    }
    let cqn2sql = new this.class.CQN2SQL(this)
    return cqn2sql.render(q, values)
  }

  /**
   * @param {import('@sap/cds/apis/cqn').Query} q
   * @returns {import('./infer/cqn').Query}
   */
  cqn4sql(q) {
    if (!q.SELECT?.from?.join && !q.SELECT?.from?.SELECT && !this.model?.definitions[_target_name4(q)]) return _unquirked(q)
    return cqn4sql(q, this.model)
  }

  /**
   * Returns a Promise which resolves to a prepared statement object with
   * `{run,get,all}` signature as specified in {@link PreparedStatement}.
   * @abstract
   * @param {string} sql The SQL String to be prepared
   * @returns {PreparedStatement}
   */
  async prepare(sql) {
    sql
    throw '2b overridden by subclass'
  }

  /**
   * Used to execute simple SQL statement like BEGIN, COMMIT, ROLLBACK
   * @param {string} sql
   * @returns {Promise<unknown>} The result of the query
   */
  async exec(sql) {
    sql
    throw '2b overridden by subclass'
  }
}

/**
 * Interface of prepared statement objects as returned by {@link SQLService#prepare}
 * @class
 * @interface
 */
class PreparedStatement {

  /**
   * Executes a prepared DML query, i.e., INSERT, UPDATE, DELETE, CREATE, DROP
   * @abstract
   * @param {unknown|unknown[]} binding_params
   */
  async run(binding_params) {
    binding_params
    return 0
  }
  /**
   * Executes a prepared SELECT query and returns a single/first row only
   * @abstract
   * @param {unknown|unknown[]} binding_params
   * @returns {Promise<unknown>}
   */
  async get(binding_params) {
    binding_params
    return {}
  }
  /**
   * Executes a prepared SELECT query and returns an array of all rows
   * @abstract
   * @param {unknown|unknown[]} binding_params
   * @returns {Promise<unknown[]>}
   */
  async all(binding_params) {
    binding_params
    return [{}]
  }
  /**
   * Executes a prepared SELECT query and returns a stream of the result
   * @abstract
   * @param {unknown|unknown[]} binding_params
   * @returns {ReadableStream<string|Buffer>} A stream of the result
   */
  async stream(binding_params) {
    binding_params
  }
}
SQLService.prototype.PreparedStatement = PreparedStatement

const _target_name4 = q => {
  const target =
    q.SELECT?.from ||
    q.INSERT?.into ||
    q.UPSERT?.into ||
    q.UPDATE?.entity ||
    q.DELETE?.from ||
    q.CREATE?.entity ||
    q.DROP?.entity ||
    q.STREAM?.from ||
    q.STREAM?.into
  if (target?.SET?.op === 'union') throw new cds.error('UNION-based queries are not supported')
  if (!target?.ref) return target
  const [first] = target.ref
  return first.id || first
}

const _unquirked = q => {
  if (!q) return q
  else if (typeof q.SELECT?.from === 'string') q.SELECT.from = { ref: [q.SELECT.from] }
  else if (typeof q.INSERT?.into === 'string') q.INSERT.into = { ref: [q.INSERT.into] }
  else if (typeof q.UPSERT?.into === 'string') q.UPSERT.into = { ref: [q.UPSERT.into] }
  else if (typeof q.UPDATE?.entity === 'string') q.UPDATE.entity = { ref: [q.UPDATE.entity] }
  else if (typeof q.DELETE?.from === 'string') q.DELETE.from = { ref: [q.DELETE.from] }
  else if (typeof q.CREATE?.entity === 'string') q.CREATE.entity = { ref: [q.CREATE.entity] }
  else if (typeof q.DROP?.entity === 'string') q.DROP.entity = { ref: [q.DROP.entity] }
  return q
}


const sqls = new class extends SQLService { get factory() { return null } }
cds.extend(cds.ql.Query).with(
  class {
    forSQL() {
      let cqn = (cds.db || sqls).cqn4sql(this)
      return this.flat(cqn)
    }
    toSQL() {
      if (this.SELECT) this.SELECT.expand = 'root' // Enforces using json functions always for top-level SELECTS
      let { sql, values } = (cds.db || sqls).cqn2sql(this)
      return { sql, values } // skipping .cqn property
    }
    toSql() {
      return this.toSQL().sql
    }
  },
)

Object.assign(SQLService, { _target_name4 })
module.exports = SQLService
