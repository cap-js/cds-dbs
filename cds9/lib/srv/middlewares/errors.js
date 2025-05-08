const cds = require('../..'), {i18n} = cds
const LOG = cds.log('error')
const internals = /\n +at .*(?:node_modules\/express|node:).*/gm
const is_test = typeof global.it === 'function'

module.exports = () => {
  /** @param {import('express').Response} res */
  return function http_error (err, req, res, next) { // eslint-disable-line no-unused-vars

    // In case of 401 require login if available by auth strategy
    if (typeof err === 'number') err = { code: err }
    if (err.code == 401 && req._login) return req._login()

    // Shutdown on uncaught errors, which could be critical programming errors
    if (!is_test && cds.env.server.shutdown_on_uncaught_errors)
      if (cds.error.isSystemError(err))
        return cds.shutdown(err)

    // Prepare status and a serializable error object
    let { statusCode:sc, status = sc || Number(err.code) || 500, message, toJSON, ...rest } = err // eslint-disable-line no-unused-vars
    let error = { message, ...rest, __proto__:err } // toJSON is inherited from __proto__:err
    res.status(status)

    // Log the error, with cleansed stack trace
    if (err.stack) Object.defineProperty (err, 'stack', { value: err.stack.replace (internals,'') })
    const log = status < 500 ? LOG.warn : LOG.error
    log (status, '-', error)

    // Already sent a response? => done
    if (res.headersSent) return

    // In case of 5xx errors in production don't reveal details to clients
    let PROD = process.env.NODE_ENV === 'production' || process.env.CDS_ENV === 'prod'
    if (PROD && status >= 500 && error.$sanitize !== false) error = {
      message: i18n.messages.at(status, cds.context.locale) || 'Internal Server Error',
      code: String(status), // toJSON is intentionally gone
    }

    // Errors can come with a custom $response() method to control how the
    // error response shall be structured; default: { error: { ... } }
    // E.g., SCIM doesn't wrap the error => err.$response = err => err
    let response = err.$response?.call(error,error) || { error }

    // Finally send the error response
    return res.json (response)
  }
}
