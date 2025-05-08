const auth      = exports.auth      = require('./auth')
const context   = exports.context   = require('./cds-context')
const ctx_model = exports.ctx_model = require('./ctx-model')
const errors    = exports.errors    = require('./errors')
const trace     = exports.trace     = require('./trace')

// middlewares running before protocol adapters
exports.before = [
  context,    // provides cds.context
  trace,      // provides detailed trace logs when DEBUG=trace
  auth,       // provides cds.context.user & .tenant
  ctx_model,  // fills in cds.context.model, in case of extensibility
].map(mw => _instantiate(mw))

// middlewares running after protocol adapters -> usually error middlewares
exports.after = [
  errors,    // provides final error handling
].map(mw => _instantiate(mw))

/**
 * Convenience method to add custom middlewares like so:
 * ```js
 * cds.middlewares.add (mymw, {at:0}) // to the front
 * cds.middlewares.add (mymw, {at:2})
 * cds.middlewares.add (mymw, {before:'auth'})
 * cds.middlewares.add (mymw, {after:'auth'})
 * cds.middlewares.add (mymw) // to the end
 * ```
 */
exports.add = (new_mw, { at: index, before, after, options } = {}) => {
  let mw = _isNotWrapped(new_mw) ? new_mw : new_mw (options)
  if (index !== undefined) return exports.before.splice (index, 0, mw)
  if (before) return exports.before.splice (_index4(before), 0, mw)
  if (after)  return exports.before.splice (_index4(after)+1, 0, mw)
  else return exports.before.push(mw)
}

const _isNotWrapped = mw => (typeof mw === 'function' && mw.length === 3) || Array.isArray(mw)

function _index4 (middleware) {
  if (typeof middleware === 'string') middleware = exports[middleware]
  if (!middleware) throw new Error (`Didn't find a middleware matching ${{middleware}}`)
  const index = exports.before.findIndex(mw => mw.factory === middleware)
  if (index === -1) throw new Error (`Didn't find ${{middleware}} in cds.middlewares.before`)
  return index
}

function _instantiate (factory,o) {
  let mw = factory(o)
  return mw && Object.assign(mw,{factory})
}
