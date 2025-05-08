const Whereable = require('./Whereable')
class DELETE extends Whereable {

  /** @type import('./cqn').DELETE['DELETE'] */
  DELETE = {}

  static call = (..._) => (new this).from(..._)
  static API = { class:this,
    from: (..._) => (new this).from(..._)
  }

  from (entity, ...etc) {
    this.DELETE.from = this._target4 (entity, ...etc) // supporting tts
    if (!entity.raw && etc.length) this.byKey(etc[0])
    return this
  }

  valueOf() {
    return super.valueOf('DELETE FROM')
  }

  get _subject(){ return this.DELETE.from }
}

/** @type DELETE.API & (...entries:[]) => DELETE */
module.exports = DELETE.init()
