const PROCESSING = 'processing'
const LOCKED = 'locked'
const QUEUED = 'queued'
const SCHEDULED = 'scheduled'
const PLANNED = 'planned'

module.exports = class TaskRunner {
  constructor() {
    this.states = new Map()
  }

  _setStateProp(prop, state, { name, tenant }) {
    const statesSrv = this.states.get(name)
    if (!statesSrv) {
      const newStatesSrv = new Map()
      newStatesSrv.set(tenant, { [prop]: state })
      this.states.set(name, newStatesSrv)
      return state
    }
    const obj = statesSrv.get(tenant)
    if (!obj) {
      statesSrv.set(tenant, { [prop]: state })
      return state
    }
    obj[prop] = state
    return state
  }

  _getStateProp(prop, { name, tenant }) {
    const statesSrv = this.states.get(name)
    if (!statesSrv) return
    const obj = statesSrv.get(tenant)
    return obj && obj[prop]
  }

  run({ name, tenant }, cb) {
    const scheduled = this._getStateProp(SCHEDULED, { name, tenant })
    if (scheduled) return // maybe make that configurable, we can also 'refresh' the current try
    const processingState = this._getStateProp(PROCESSING, { name, tenant })
    if (processingState === LOCKED) {
      this._setStateProp(PROCESSING, QUEUED, { name, tenant })
      return
    }
    if (processingState === QUEUED) return
    if (!processingState) this._setStateProp(PROCESSING, LOCKED, { name, tenant })
    return cb()
  }

  // Schedule if not already scheduled
  schedule({ name, tenant, waitingTime }, cb) {
    if (this._getStateProp(SCHEDULED, { name, tenant })) return
    const timer = setTimeout(() => {
      this._setStateProp(SCHEDULED, undefined, { name, tenant })
      return cb()
    }, waitingTime).unref()
    this._setStateProp(SCHEDULED, timer, { name, tenant })
  }

  // Allows to plan, the shortest time wins
  plan({ name, tenant, waitingTime }, cb) {
    const newDate = Date.now() + waitingTime
    const alreadyPlanned = this._getStateProp(PLANNED, { name, tenant })
    if (!alreadyPlanned || alreadyPlanned.date > newDate) {
      if (alreadyPlanned) clearInterval(alreadyPlanned.timer)
      this._setStateProp(
        PLANNED,
        {
          date: newDate,
          timer: setTimeout(() => (this._setStateProp(PLANNED, undefined, { name, tenant }), cb()), waitingTime)
        },
        { name, tenant }
      )
    }
  }

  end({ name, tenant }, cb) {
    const processingState = this._getStateProp(PROCESSING, { name, tenant })
    this._setStateProp(PROCESSING, undefined, { name, tenant })
    if (processingState === QUEUED) {
      return cb()
    }
  }

  success({ name, tenant }) {
    const timer = this._getStateProp(SCHEDULED, { name, tenant })
    if (timer) {
      // once successful, we don't want to have another scheduled run
      clearTimeout(timer)
      this._setStateProp(SCHEDULED, undefined, { name, tenant })
    }
  }
}
