const Query = require('./cds.ql-Query')
class CREATE extends Query {

  /** @type import('./cqn').CREATE['CREATE'] */
  CREATE = {}

  static call = (..._) => (new this).entity(..._)
  static API = { class:this,
    entity: (..._) => (new this).entity(..._)
  }

  entity (e, elements) {
    if (elements)
      this.CREATE.entity = { elements: elements, kind: 'entity', name:e }
    else
      this.CREATE.entity = e && e.elements ? e : this._target4(e)
    return this
  }

  as (query) {
    if (!query || !query.SELECT) this._expected `${{query}} to be a CQN {SELECT} object`
    this.CREATE.as = query
    return this
  }

  get _subject(){ return this.CREATE.entity }
}

/** @type CREATE.API & (...entries:[]) => CREATE */
module.exports = CREATE.init()
