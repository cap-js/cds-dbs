const cds = require('../cds')

const postProcess = require('./utils/postProcess')

/**
 * Generic Application Service Provider
 */
class ApplicationService extends cds.Service {
  init() {
    const clazz = this.constructor
    for (let each of clazz.generics) clazz[each].call(this)
    return super.init()
  }
  static get generics() {
    return (this._generics ??= new Set([
      ...(this.__proto__.generics || []),
      ...Reflect.ownKeys(this).filter(p => p.startsWith('handle_'))
    ]))
  }

  static get handle_authorization() {
    return require('./generic/auth')
  }

  static get handle_etags() {
    return require('./generic/etag')
  }

  static get handle_validations() {
    return require('./generic/input')
  }

  static get handle_stream_property() {
    return require('./generic/stream-only')
  }

  static get handle_temporal_data() {
    return require('./generic/temporal')
  }

  static get handle_paging() {
    return require('./generic/paging') // > paging must be executed before sorting
  }

  static get handle_sorting() {
    return require('./generic/sorting')
  }

  static get handle_drafts() {
    return require('../fiori/lean-draft')
  }

  static get handle_crud() {
    return require('./generic/crud')
  }

  // Overload .handle in order to resolve projections up to a definition that is known by the remote service instance.
  // Result is post processed according to the inverse projection in order to reflect the correct result of the original query.
  async handle(req) {
    // REVISIT: We must not allow arbitrary CQNs, so this shouldn't be here!
    if (!this._requires_resolving?.(req)) return super.handle(req)
    // rewrite the query to a target entity served by this service...
    const query = this.resolve(req.query)
    if (!query) throw new Error(`Target ${req.target.name} cannot be resolved for service ${this.name}`)
    const target = query._target || req.target
    // we need to provide target explicitly because it's cached within ensure_target
    const _req = new cds.Request({ query, target, _resolved: true })
    return await this.dispatch(_req).then(result => postProcess(query, result, this))
  }
}

// NOTE: getRestrictions is VERY INOFFICIAL!!!
//> only kept temporary because of an ill-devised usage in AMS plugin
const { getRestrictions } = require('./generic/auth/restrictions')
ApplicationService.prototype.getRestrictions = function (..._) {
  return getRestrictions.call(this, ..._)
}

ApplicationService.prototype.isAppService = true
module.exports = ApplicationService
