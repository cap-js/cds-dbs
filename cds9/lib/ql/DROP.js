const Query = require('./cds.ql-Query')
class DROP extends Query {

  /** @type import('./cqn').DROP['DROP'] */
  DROP = {}

  static call = (..._) => (new this).entity(..._)
  static API = { class:this,
    entity: (..._) => (new this).entity(..._),
    table: (..._) => (new this).table(..._),
    view: (..._) => (new this).view(..._),
  }

  entity(e) {
    this.DROP.entity = this._target4 (e)
    return this
  }
  table(e) {
    const {DROP} = this
    DROP.entity = DROP.table = this._target4 (e)
    return this
  }
  view(e) {
    const {DROP} = this
    DROP.entity = DROP.view = this._target4 (e)
    return this
  }

  get _subject(){ return this.DROP.entity }
}

/** @type DROP.API & (...entries:[]) => DROP */
module.exports = DROP.init()
