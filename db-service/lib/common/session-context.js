const cds = require('@sap/cds')

class SessionContext {
  constructor(ctx) {
    Object.defineProperty(this, 'ctx', { value: ctx })
  }
  get '$user.id'() {
    return (super['$user.id'] = this.ctx.user?.id || 'anonymous')
  }
  get '$user.locale'() {
    return (super['$user.locale'] = this.ctx.locale || cds.env.i18n.default_language)
  }
  // REVISIT: should be decided in spec meeting for definitive name
  get $now() {
    return (super.$now = (this.ctx.timestamp || new Date()).toISOString())
  }
}

class TemporalSessionContext extends SessionContext {
  get '$valid.from'() {
    return (super['$valid.from'] = this.ctx._?.['VALID-FROM'] ?? this.ctx._?.['VALID-AT'] ?? new Date().toISOString())
  }
  get '$valid.to'() {
    return (super['$valid.to'] =
      this.ctx._?.['VALID-TO'] ??
      this.ctx._?.['VALID-AT']?.replace(/(\dZ?)$/, d => parseInt(d[0]) + 1 + d[1] || '') ??
      new Date().toISOString().replace(/(\dZ?)$/, d => parseInt(d[0]) + 1 + d[1] || ''))
  }
}

// Set all getters as enumerable
const iterate = { enumerable: true }
const getters = (obj) => {
  const prot = obj.prototype
  const patch = {}
  for (const [key, value] of Object.entries(Object.getOwnPropertyDescriptors(prot))) {
    if (!value.get) continue
    patch[key] = iterate
  }
  Object.defineProperties(prot, patch)
}
getters(SessionContext)
getters(TemporalSessionContext)

// REVISIT: only set temporal context if required!
module.exports = TemporalSessionContext
