const express = require('express')

// basically express.json() with string representation of body stored in req._raw for recovery
// REVISIT: why do we need our own body parser? Only because of req._raw?
module.exports = function bodyParser4(adapter, options = {}) {
  Object.assign(options, adapter.body_parser_options)
  options.type ??= 'json' // REVISIT: why do we need to override type here?
  const textParser = express.text(options)
  return function http_body_parser(req, res, next) {
    if (typeof req.body === 'object') {
      //> body already deserialized (e.g., batch subrequest or custom body parser)
      if (!req._raw) req._raw = JSON.stringify(req.body) //> ensure req._raw is set
      return next()
    }
    textParser(req, res, function http_body_parser_next(err) {
      if (err) return next(Object.assign(err, { statusCode: 400 }))
      if (typeof req.body !== 'string') return next()

      req._raw = req.body || '{}'
      try {
        req.body = JSON.parse(req._raw)
      } catch (e) {
        // Need to wrap, as a rethrow would crash the server
        let err = new InvalidJSON(e.message)
        return next(err)
      }
      next()
    })
  }
}

class InvalidJSON extends Error {}
InvalidJSON.prototype.name = 'Invalid JSON body'
InvalidJSON.prototype.status = 400
