const cds = require('../index')
const Query = require('./cds.ql-Query')


class Whereable extends Query {

  where (...args) { return this._where (args) }
  and (...args) { return this._and_or ('and',args) }
  or (...args) { return this._and_or ('or',args) }

  /** @protected */
  _where (args, clause='where', cqn=this[this.kind]) {
    let tail = cds.ql.predicate(...args); if (!tail?.length) return this
    let head = cqn[clause]
    if (!head) cqn[clause] = tail
    else { //> always wrap ORs on subsequent .where() calls, as these happen somewhere else
      if (head.includes('or')) head = [{xpr:head}]
      if (tail.includes('or')) tail = [{xpr:tail}]
      cqn[clause] = [ ...head, 'and', ...tail ]
    }
    this._clause = this._direct = clause
    return this
  }

  /** @private */
  _and_or (ao, args) {
    const $ = this[this.kind]
    let clause = this._clause ??= ( //> some projects use .and()/.or() with manually filled in .where
      $.having ? 'having' :
      $.where ? 'where' :
      $.from?.on ? 'on' :
      cds.error `Unexpected use of .${ao}() without prior .where(), .having(), or .on()`
    )
    let tail = cds.ql.predicate(...args); if (!tail?.length) return this
    let cqn = clause === 'on' ? $.from : $
    let head = cqn[clause], direct = this._direct; delete this._direct
    if (direct && ao === 'and') //> wrap ORs for .and() directly following .where()
      if (head.includes('or')) head = [{xpr:head}]
    if (tail.includes('or')) tail = [{xpr:tail}]
    cqn[clause] = [ ...head, ao, ...tail ]
    return this
  }

  byKey (key) {
    if (typeof key !== 'object' || key === null)
      key = cds.env.features.keys_as_val ? { val: key } : { [Object.keys(this._target.keys||{ID:1})[0]]: key }
    if (this.SELECT) this.SELECT.one = true
    if (cds.env.features.keys_into_where) return this.where(key)
    const {ref} = this._subject
    ref[ref.length-1] = { id: ref.at(-1), where: cds.ql.predicate(key) }
    return this
  }

  /** @private */ set _clause (clause) { this._set('_clause',clause) }
  /** @private */ set _direct (clause) { this._set('_direct',clause) }
}

module.exports = Whereable
