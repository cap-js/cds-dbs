const Query = require('./cds.ql-Query')
class INSERT extends Query {

  /** @type import('./cqn').INSERT['INSERT'] */
  INSERT = {}

  static call = (..._) => (new this).entries(..._)
  static API = { class:this,
    into: (..._) => (new this).into(..._)
  }

  into (entity, ...data) {
    this[this.kind].into = this._target4 (entity, ...data) // supporting tts
    if (data.length) this.entries(...data)
    return this
  }

  entries (...x) {
    if (!x.length) return this
    if (x[0].SELECT) return this.from(x[0])
    this[this.kind].entries = is_array(x[0]) ? x[0] : x
    return this
  }
  columns (...x) {
    this[this.kind].columns = is_array(x[0]) ? x[0] : x
    return this
  }
  values (...x) {
    this[this.kind].values = is_array(x[0]) ? x[0] : x
    return this
  }
  rows (...rows) {
    if (is_array(rows[0]) && is_array(rows[0][0])) rows = rows[0]
    if (!is_array(rows[0])) this._expected `Arguments ${{rows}} to be an array of arrays`
    this[this.kind].rows = rows
    return this
  }

  from (query) {
    if (!query) return this
    else if (query.name || typeof query === 'string') query = SELECT.from(query)
    else if (!query.SELECT) this._expected `${{query}} to be a CQN {SELECT} query object`
    this[this.kind].from = query
    return this
  }

  valueOf() {
    return super.valueOf('INSERT INTO')
  }

  get _subject(){ return this.INSERT.into }
}

const is_array = Array.isArray

/** @type INSERT.API & (...entries:[]) => INSERT */
module.exports = INSERT.init()
