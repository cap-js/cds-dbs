const { class:INSERT } = require('./INSERT')
class UPSERT extends INSERT {

  /** @type import('./cqn').UPSERT['UPSERT'] */
  UPSERT = {}

  constructor() { delete super().INSERT }
  static call = (..._) => (new this).entries(..._)
  static API = { class:this,
    into: (..._) => (new this).into(..._)
  }

  get _subject(){ return this.UPSERT.into }
}

/** @type UPSERT.API & (...entries:[]) => UPSERT */
module.exports = UPSERT.init()
