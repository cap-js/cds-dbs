const cds = require('@sap/cds/lib'),
  DEBUG = cds.debug('sql|db')
const { resolveView } = require('@sap/cds/libx/_runtime/common/utils/resolveView')
const DatabaseService = require('./common/DatabaseService')
const cqn4sql = require('./cqn4sql')
const { PassThrough, pipeline } = require('stream')

class SQLService extends DatabaseService {
  init() {
    this.on(['INSERT', 'UPSERT', 'UPDATE', 'DELETE'], require('./fill-in-keys')) // REVISIT should be replaced by correct input processing eventually
    this.on(['INSERT', 'UPSERT', 'UPDATE', 'DELETE'], require('./deep-queries').onDeep)
    this.on(['SELECT'], this.onSELECT)
    this.on(['INSERT'], this.onINSERT)
    this.on(['UPSERT'], this.onUPSERT)
    this.on(['UPDATE'], this.onUPDATE)
    this.on(['DELETE', 'CREATE ENTITY', 'DROP ENTITY'], this.onSIMPLE)
    this.on(['BEGIN', 'COMMIT', 'ROLLBACK'], this.onEVENT)
    this.on(['*'], this.onPlainSQL)
    return super.init()
  }

  /** Handler for SELECT */
  async onSELECT({ query, data }) {
    // REVISIT: disable this for queries like (SELECT 1)
    // Will return multiple rows with objects inside
    // REVISIT: streaming: if we need custom app and db handlers with app stream and cds.stream
    if (query._streaming) return this.onStream(query) // TODO: implemented on HANA
    query.SELECT.expand = 'root'
    const { sql, values, cqn } = this.cqn2sql(query, data)
    let ps = await this.prepare(sql)
    let rows = await ps.all(values)
    if (rows.length)
      if (cqn.SELECT.expand) rows = rows.map(r => (typeof r._json_ === 'string' ? JSON.parse(r._json_) : r._json_ || r))
    if (cqn.SELECT.count) rows.$count = await this.count(query, rows)
    return cqn.SELECT.one || query.SELECT.from.ref?.[0].cardinality?.max === 1 ? rows[0] || null : rows
  }

  async onINSERT({ query, data }) {
    const { sql, entries, cqn } = this.cqn2sql(query, data)
    if (!sql) return // Do nothing when there is nothing to be done
    const ps = await this.prepare(sql)
    const results = entries ? await Promise.all(entries.map(e => ps.run(e))) : await ps.run()
    return new this.class.InsertResults(cqn, results)
  }

  async onUPSERT({ query, data }) {
    const { sql, entries } = this.cqn2sql(query, data)
    if (!sql) return // Do nothing when there is nothing to be done
    const ps = await this.prepare(sql)
    const results = entries ? await Promise.all(entries.map(e => ps.run(e))) : await ps.run()
    return results.reduce((lastValue, currentValue) => (lastValue += currentValue.changes), 0)
  }

  /** Handler for UPDATE */
  async onUPDATE(req) {
    return this.onSIMPLE(req)
  }

  /** Handler for CREATE, DROP, UPDATE, DELETE, with simple CQN */
  async onSIMPLE({ query, data }) {
    const { sql, values } = this.cqn2sql(query, data)
    let ps = await this.prepare(sql)
    return (await ps.run(values)).changes
  }

  /** Handler for BEGIN, COMMIT, ROLLBACK, which don't have any CQN */
  async onEVENT({ event }) {
    DEBUG?.(event) // in the other cases above DEBUG happens in cqn2sql
    return await this.exec(event)
  }

  /** Handler for SQL statements which don't have any CQN */
  async onPlainSQL({ query, data }, next) {
    if (typeof query === 'string') {
      DEBUG?.(query)
      const ps = await this.prepare(query)
      const exec = this.hasResults(query) ? d => ps.all(d) : d => ps.run(d)
      if (Array.isArray(data) && typeof data[0] === 'object') return await Promise.all(data.map(exec))
      else return exec(data)
    } else return next()
  }

  /** Override in subclasses to detect more statements to be called with ps.all() */
  hasResults(sql) {
    return /^(SELECT|WITH|CALL|PRAGMA table_info)/.test(sql)
  }

  /** Derives and executes a query to fill in `$count` for given query */
  async count(query, ret) {
    if (ret) {
      const { one, limit: _ } = query.SELECT,
        n = ret.length
      const [max, offset = 0] = one ? [1] : _ ? [_.rows?.val, _.offset?.val] : []
      if (max === undefined || (n < max && (n || !offset))) return n + offset
    }
    const cq = cds.ql.clone(query, {
      columns: [{ func: 'count' }],
      localized: false,
      expand: false,
      limit: 0,
      orderBy: 0
    })
    const { sql, values } = this.cqn2sql(cq)
    const ps = await this.prepare(sql)
    const { count } = await ps.get(values)
    return count
  }

  /**
   * Streaming
   * Returns either a readable stream for sync calls or a readable stream promise for async calls
   */
  stream(q) {
    return typeof q === 'object'
      ? // aynchronous API: cds.stream(query)
        this.run(Object.assign(q, { _streaming: true }))
      : // synchronous API: cds.stream('column').from(entity).where(...)
        new StreamCQN(q, this)
  }

  static InsertResults = require('./InsertResults')

  /**
   * Helper class implementing {@link SQLService#cqn2sql}.
   * Subclasses commonly override this.
   */
  static CQN2SQL = require('./cqn2sql').class
  constructor() {
    super(...arguments)
    this.class = new.target // for IntelliSense
  }
  cqn2sql(q, values) {
    const cqn = this.cqn4sql(q)

    const cmd = cqn.cmd || Object.keys(cqn)[0]
    if (cmd in { INSERT: 1, DELETE: 1, UPSERT: 1, UPDATE: 1 }) {
      let resolvedCqn = resolveView(cqn, this.model, this)
      if (resolvedCqn && resolvedCqn[cmd]._transitions?.[0].target) {
        resolvedCqn = resolvedCqn || cqn
        resolvedCqn.target = resolvedCqn?.[cmd]._transitions[0].target || cqn.target
      }
      return new this.class.CQN2SQL(this.context).render(resolvedCqn, values)
    }
    return new this.class.CQN2SQL(this.context).render(cqn, values)
  }
  cqn4sql(q) {
    // REVISIT: move this check to cqn4sql?
    if (!q.SELECT?.from?.join && !this.model?.definitions[_target_name4(q)]) return _unquirked(q)
    return cqn4sql(q, this.model)
  }

  /**
   * Returns a Promise which resolves to a prepared statement object with
   * `{run,get,all}` signature as specified in {@link PreparedStatement}.
   * @returns {PreparedStatement}
   */
  // eslint-disable-next-line no-unused-vars
  async prepare(/*sql*/) {
    throw '2b overridden by subclass'
  }

  /**
   * Used to execute simple SQL statement like BEGIN, COMMIT, ROLLBACK
   */
  // eslint-disable-next-line no-unused-vars
  async exec(sql) {
    throw '2b overridden by subclass'
  }
}

/** Interface of prepared statement objects as returned by {@link SQLService#prepare} */
class PreparedStatement {
  // eslint-disable-line no-unused-vars
  /**
   * Executes a prepared DML query, i.e., INSERT, UPDATE, DELETE, CREATE, DROP
   * @param {[]|{}} binding_params
   */
  async run(/*binding_params*/) {} // eslint-disable-line no-unused-vars
  /**
   * Executes a prepared SELECT query and returns a single/first row only
   * @param {[]|{}} binding_params
   */
  async get(/*binding_params*/) {
    return {}
  } // eslint-disable-line no-unused-vars
  /**
   * Executes a prepared SELECT query and returns an array of all rows
   * @param {[]|{}} binding_params
   */
  async all(/*binding_params*/) {
    return [{}]
  } // eslint-disable-line no-unused-vars
}
SQLService.prototype.PreparedStatement = PreparedStatement

/**
 * Class that builds and runs stream CQN
 */
class StreamCQN {
  constructor(column, srv) {
    this.column = column
    this.srv = srv
    this.result = new PassThrough()
  }
  /** synchronous streaming API: returns readable stream or class instance for chaining */
  from(...args) {
    this.sq = SELECT.from(...args)
    this.sq._streaming = true
    if (this.column) this.sq.columns([this.column])
    const ref = this.sq.SELECT.from.ref
    if (!ref?.[ref.length - 1].where) return this
    this._runStream()
    return this.result
  }
  /** synchronous streaming API: returns readable stream */
  where(...args) {
    this.sq.where(...args)
    this._runStream()
    return this.result
  }

  async _runStream() {
    try {
      const stream = await this.srv.run(this.sq)
      // In case of streaming error while streaming from stream to this.result
      // the error is emitted to both streams. After this the output stream this.result is destroyed.
      // No explicit closing of this.result is needed.
      // In (theoretical) case if for some error this.result is not destroyed the code like below can be used
      // as callback: err => err && this.result.push(null)
      stream ? pipeline(stream, this.result, () => {}) : this.result.push(null)
    } catch (err) {
      this.result.emit('error', err)
      this.result.push(null)
    }
  }
}

const _target_name4 = q => {
  const target =
    q.SELECT?.from ||
    q.INSERT?.into ||
    q.UPSERT?.into ||
    q.UPDATE?.entity ||
    q.DELETE?.from ||
    q.CREATE?.entity ||
    q.DROP?.entity ||
    undefined
  if (target?.SET?.op === 'union') throw new cds.error('”UNION” based queries are not supported')
  if (!target?.ref) return target
  const [first] = target.ref
  return first.id || first
}

const _unquirked = q => {
  if (typeof q.INSERT?.into === 'string') q.INSERT.into = { ref: [q.INSERT.into] }
  if (typeof q.UPSERT?.into === 'string') q.UPSERT.into = { ref: [q.UPSERT.into] }
  if (typeof q.UPDATE?.entity === 'string') q.UPDATE.entity = { ref: [q.UPDATE.entity] }
  if (typeof q.DELETE?.from === 'string') q.DELETE.from = { ref: [q.DELETE.from] }
  if (typeof q.CREATE?.entity === 'string') q.CREATE.entity = { ref: [q.CREATE.entity] }
  if (typeof q.DROP?.entity === 'string') q.DROP.entity = { ref: [q.DROP.entity] }
  return q
}

module.exports = Object.assign(SQLService, { _target_name4 })
