const cds = require('../../')

const util = require('util')

const L2L = { 1: 'error', 2: 'warn', 3: 'info', 4: 'debug', 5: 'trace' }
const HEADER_MAPPINGS = {
  x_vcap_request_id: 'request_id',
  content_length: 'request_size_b',
  traceparent: 'w3c_traceparent'
}

const _is4xx = ele =>
  (ele.code >= 400 && ele.code < 500) ||
  (ele.status >= 400 && ele.status < 500) ||
  (ele.statusCode >= 400 && ele.statusCode < 500)

const $remove = Symbol('remove')

const _is_custom_fields = (arg, custom_fields) => {
  if (!Object.keys(arg).length) return false
  for (const k in arg) if (!custom_fields.has(k)) return false
  return true
}

const _is_categories = arg => arg?.categories && Array.isArray(arg.categories) && Object.keys(arg).length === 1

const _extract_custom_fields_and_categories = (args, toLog, custom_fields) => {
  if (args.length) {
    let filter4removed = false
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (typeof arg !== 'object' || arg === null) continue
      if ((custom_fields.size && _is_custom_fields(arg, custom_fields)) || _is_categories(arg)) {
        Object.assign(toLog, arg)
        args[i] = $remove
        filter4removed = true
      }
    }
    if (filter4removed) args.sort((a, b) => (b === $remove) * -1).splice(args.lastIndexOf($remove))
  }
}

const _getCircularReplacer = () => {
  const seen = new WeakSet()
  return (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return 'cyclic'
      seen.add(value)
    }
    return value
  }
}

/*
 * JSON-based log formatter for use in production
 */
module.exports = function format(module, level, ...args) {
  // config
  const { user: log_user, mask_headers, aspects } = cds.env.log
  this._MASK_HEADERS ??= (mask_headers || []).map(s => {
    const parts = s.match(/\/(.+)\/(\w*)/)
    if (parts) return new RegExp(parts[1], parts[2])
    return new RegExp(s)
  })
  this._ASPECTS ??= (aspects || []).map(require)

  // the object to log
  const toLog = {
    level: L2L[level] || 'info',
    logger: module
  }

  // add correlation
  if (cds.context) {
    const { id, tenant, user } = cds.context
    toLog.correlation_id = id
    if (tenant) toLog.tenant_id = tenant
    // log user id, if configured (data privacy)
    if (user && log_user) toLog.remote_user = user.id
    // if available, add headers (normalized to lowercase and with _ instead of -) with masking as configured and mappings applied
    const headers = cds.context.http?.req?.headers
    if (headers) {
      for (const k in headers) {
        const h = k.replace(/-/g, '_').toLowerCase()
        toLog[h] = (() => {
          if (this._MASK_HEADERS.some(m => k.match(m))) return '***'
          return headers[k]
        })()
        if (h in HEADER_MAPPINGS) toLog[HEADER_MAPPINGS[h]] = toLog[h]
      }
    }
  }
  toLog.timestamp = new Date()

  // start message with leading string args (if any)
  const i = args.findIndex(arg => typeof arg === 'object' && arg?.message)
  if (i > 0 && args.slice(0, i).every(arg => typeof arg === 'string')) toLog.msg = args.splice(0, i).join(' ')

  // merge toLog with passed Error (or error-like object)
  if (args.length && typeof args[0] === 'object' && args[0].message) {
    const err = args.shift()
    toLog.msg = `${toLog.msg ? toLog.msg + ' ' : ''}${err.message}`
    if (typeof err.stack === 'string' && !_is4xx(err)) toLog.stacktrace = err.stack.split(/\s*\r?\n\s*/)
    if (Array.isArray(err.details)) {
      for (const d of err.details) {
        // preserve message property through stringification
        if (d.message) Object.defineProperty(d, 'message', { value: d.message, enumerable: true })
        if (typeof d.stack === 'string' && !_is4xx(d)) d.stacktrace = d.stack.split(/\s*\r?\n\s*/)
      }
    }
    Object.assign(toLog, err, { level: toLog.level })
  }

  /*
   * apply aspects:
   * 1. extract custom fields (provided by the aspects) and categories from remaining args
   * 2. actually apply the aspects
   */
  if (!this._custom_fields) {
    this._custom_fields = new Set()
    for (const each of this._ASPECTS) if (each.cf) each.cf().forEach(v => this._custom_fields.add(v))
  }
  _extract_custom_fields_and_categories(args, toLog, this._custom_fields)
  for (const each of this._ASPECTS) each.call(this, module, level, args, toLog)

  // append remaining args via util.format()
  if (args.length) toLog.msg = toLog.msg ? util.format(toLog.msg, ...args) : util.format(...args)

  // ensure type (required on kubernetes if logs are pulled instead of pushed through binding)
  toLog.type ??= 'log'

  // REVISIT: should not be necessary with new protocol adapters
  // 4xx: lower to warning (if error)
  if (toLog.level && toLog.level.match(/error/i) && _is4xx(toLog)) toLog.level = 'warn'

  // return array with the stringified toLog (to avoid multiple log lines) as the sole element
  try {
    return [JSON.stringify(toLog)]
  } catch {
    // try again with removed circular references
    return [JSON.stringify(toLog, _getCircularReplacer())]
  }
}
