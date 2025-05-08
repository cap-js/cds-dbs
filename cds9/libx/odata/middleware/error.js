const cds = require('../../../lib')
const { shutdown_on_uncaught_errors } = cds.env.server

exports = module.exports = () =>
  function odata_error(err, req, res, next) {
    if (exports.pass_through(err)) return next(err)
    if (err.details) err = _fioritized(err)
    exports.normalizeError(err, req)
    const content_id = req.headers['content-id']
    if (content_id) {
      err['@Core.ContentID'] = content_id
      err.details?.forEach(e => (e['@Core.ContentID'] = content_id))
    }
    if (err.numericSeverity) {
      if (err.numericSeverity < 4) err['@Common.numericSeverity'] = err.numericSeverity // REVISIT: do we need that at all?
      delete err.numericSeverity
    }
    return next(err)
  }

exports.pass_through = err => {
  if (err == 401 || err.code == 401) return true
  if (shutdown_on_uncaught_errors && !(err.status || err.statusCode) && cds.error.isSystemError(err)) return true
}

exports.normalizeError = (err, req, cleanse = ODATA_PROPERTIES) => {
  const locale = cds.i18n.locale.from(req)
  err.status = _normalize(err, locale, cleanse) || 500
  return err
}

exports.getSapMessages = (messages, req) => {
  const locale = cds.i18n.locale.from(req)
  for (let m of messages) _normalize(m, locale, SAP_MSG_PROPERTIES)
  return JSON.stringify(messages).replace(
    /[\u007F-\uFFFF]/g,
    c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')
  )
}

const { i18n } = require('../../../lib')
const default_language = '' // NOTE: Intentionally not taken from cds.env.i18n, due to tests expecting that
const ODATA_PROPERTIES = { code: 1, message: 1, target: 1, details: 1, innererror: 1 }
const SAP_MSG_PROPERTIES = { ...ODATA_PROPERTIES, longtextUrl: 2, transition: 2, numericSeverity: 2 }
const BAD_REQUESTS = { ENTITY_ALREADY_EXISTS: 1, FK_CONSTRAINT_VIOLATION: 2, UNIQUE_CONSTRAINT_VIOLATION: 3 }

// prettier-ignore
const _normalize = (err, locale, keep) => {

  // Determine status code if not already set
  const details = err.details?.map?.(each => _normalize (each, locale, keep))
  const status = err.status || err.statusCode || _status4(err) || _reduce(details)

  // Determine error code and message
  const key = err.message || err.code || status
  const msg = i18n.messages.at (key, default_language, err.args)
  if (msg && msg !== key) {
    if (typeof err.code !== 'string') err.code = key
    err.message = msg
  }
  if (typeof err.code !== 'string') err.code = String(err.code ?? status ?? '')

  // Cleanse and localize in response to client
  if (locale || keep) err.toJSON = function() {
    const that = keep ? {} : {...this}
    if (keep) for (let k in this) if (k in keep || k[0] === '@') that[k] = this[k]
    if (locale) that.message = i18n.messages.at (key, locale, this.args) 
    if (!that.message) that.message = this.message
    return that
  }
  return status
}

const _status4 = err => {
  if (err.code >= 300 && err.code < 600 && !err.sqlState) return Number(err.code)
  if (err.message in BAD_REQUESTS) return 400 // REVISIT: should we use 409 or 500 instead?
}

const _reduce = details => {
  const unique = [...new Set(details)]
  if (unique.length === 1) return unique[0] // if only one unique status exists, we use that
  if (unique.some(s => s >= 500)) return 500 // if at least one 5xx exists, we use 500
  if (unique.some(s => s >= 400)) return 400 // if at least one 4xx exists, we use 400
}

/**
 * According to the Fiori Elements Failed Message specification, the format must be:
 * Root level: First error, Details: Other errors
 */ // prettier-ignore
const _fioritized = cds.env.fiori.wrap_multiple_errors === false ? err => {
  const [ head, ...tail ] = err.details
  return Object.assign (err, head, { details: tail.length ? tail : undefined })
} : err => err
