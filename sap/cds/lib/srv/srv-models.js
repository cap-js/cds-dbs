// REVISIT: all handler caches (incl. templates) need to go into cached models -> eviction
// REVISIT: all edmx caches also have to be hooked in here

const cds = require ('../index')

/**
 * Implements a static cache for all tenant/features-specific models.
 * Cache keys are strings of the form `<tenant>:<comma-separated-features>`.
 * The base model `cds.model` is also in the cache with key `':'`, i.e.,
 * with undefined tenant and no activated features.
 */
class ExtendedModels {

  /**
   * Returns the model to use for given tenant and features.
   * Loaded models are cached, with eviction on inactivity of tenants,
   * and automatically refreshed when new extensions are made.
   * @returns a CSN compiled.for.nodejs and cds.linked
   */
  static async model4 (tenant, features) {

    const {cache} = ExtendedModels, key = cache.key4 (tenant, features)
    const cached = cache.at(key); if (cached) return cached
    else if (key === ':') return cache.add (':', cds.compile.for.nodejs(cds.model))
    else return cache[key] = (async()=>{ // temporarily add promise to cache to avoid race conditions...

      // If tenant doesn't have extensions check cache with tenant = undefined
      let _has_extensions = false
      try {
        _has_extensions = tenant && extensibility && await _is_extended(tenant)
      } catch (error) {
        // Better error message for client
        if (error.status === 404) throw error
        cds.error('`extensibility: true` is configured but table "cds.xt.Extensions" does not exist. Please redeploy.', error)
      }
      if (!_has_extensions) {
        let k = cache.key4 (tenant = undefined, features)
        let cached = cache.at(k); if (cached) return cached
        else if (k === ':') return cache.add (':', cds.compile.for.nodejs(cds.model))
      }

      // None cached -> obtain and cache specific model from ModelProvider
      return await _get_model4 (tenant, Object.keys(features))

    })()
    .then (m => cache.add(key,m)) // replace promise in cache by real model
    .catch (e => { delete cache[key]; throw e })
  }


  /**
   * Constructs and returns a cache key for given tenant and features.
   * @param {string} tenant string or `undefined` as obtained from `cds.context.tenant`
   * @param {object} features object as obtained from `cds.context.features`
   * @returns {string} of the form `<tenant>:<comma-separated-features>`
   */
  key4 (tenant, features) {
    return `${tenant||''}:${features?.$hash}`
  }


  /**
   * Returns the currently cached model, or a promised one.
   * Promises are added to the cache to avoid race conditions with parallel requests.
   * This implementation regularly checks for new extensions, and transparently
   * refreshes cached models if so.
   * This method is overridden with a simple `return this[key]` when extensibility
   * is switched off.
   * @param {string} key as obtained through `cache.key4(t,f)`
   * @returns { LinkedCSN | Promise<LinkedCSN> }
   */
  at (key) {
    const model = this[key]; if (!model) return
    if (model.then) return model //> promised model to avoid race conditions

    const { $touched: touched } = model, interval = ExtendedModels.checkInterval
    if (Date.now() - touched < interval) return model //> checked recently

    else return this[key] = (async()=>{ // temporarily replace cache entry by promise to avoid race conditions...

      const has_new_extensions = await cds.db.exists('cds.xt.Extensions') .where ({
        timestamp: { '>': new Date(touched).toISOString() } // REVISIT: better store epoc time in db?
        // REVISIT: GAP: CAP runtime should allow Date objects + Date.now() for all date+time types !
      })
      if (has_new_extensions) { // new extensions arrived -> refresh model in cache
        let [ tenant = undefined, toggles ] = key.split(':')
        cds.emit('cds.xt.TENANT_UPDATED', { tenant })
        return _get_model4 (tenant, toggles.split(','))
      } else {                        // no new extensions...
        model.$touched = Date.now() // check again in 1 min or so
        return model               // keep cached model in cache
      }

    })()
    .then (m => this.add(key,m))  // replace promise in cache by real model
    .catch (e => { delete this[key]; throw e })
  }


  /**
   * Adds a model into the cache under the given key.
   * Only use that method to add loaded models, while using direct assignment
   * to add promises, e.g. `cache[key] = promised_model`.
   * @param {string} key as obtained through `cache.key4(t,f)`
   * @param {LinkedCSN} model the loaded and linked model
   * @returns the given `model`
   */
  add (key, model, touched = Date.now()) {
    if (model) {
      model.$touched ??= touched
      return this[key] = model
    }
  }


  /**
   * When started, regularly evicts models for inactive tenants.
   */
  startSentinel(){
    this.sentinel = setInterval (()=>{ for (let [key,m] of Object.entries(this)) {
      if (Date.now() - m.$touched > ExtendedModels.sentinelInterval)
        delete this [key]
    }}, ExtendedModels.sentinelInterval).unref()
  }


  /** The cache instance used by `model4()`. */
  static cache = new ExtendedModels

  /** Time interval in ms to check for new extensions and refresh models, if so. */
  static checkInterval = cds.requires.extensibility?.tenantCheckInterval || 1 * 60 * 1000

  /** Time interval in ms after which to evict models for inactive tenants. */
  static sentinelInterval = cds.requires.extensibility?.evictionInterval || 3600*1000

}
module.exports = ExtendedModels

// ---------------------------------------------------------------------------
// Optimizations for single-tenancy modes

const extensibility = cds.requires.extensibility
if (!extensibility) {
  ExtendedModels.prototype.at = function (key) { return this[key] }
}


// helper to get model for tenant/features
const _is_extended = extensibility ? ()=> cds.db.exists('cds.xt.Extensions') : ()=> false
const _get_model4 = async (tenant, features) => {
  const { 'cds.xt.ModelProviderService':mps } = cds.services
  const csn = await mps.getCsn (tenant, features)
  const nsn = cds.compile.for.nodejs(csn)
  if (cds.edmxs) await cds.compile.to.edmx.files ( csn,
    // adding tenant and features to runtime model, for later use when fetching generated files
    nsn.tenant = tenant,
    nsn.features = features?.$hash
  )
  return nsn
}


// ---------------------------------------------------------------------------
// Optimizations for single-tenancy modes

if (cds.requires.multitenancy && typeof global.it === 'undefined') cds.once ('listening', ()=> ExtendedModels.cache.startSentinel())
// REVISIT: how to do ^that^ correctly with jest?
