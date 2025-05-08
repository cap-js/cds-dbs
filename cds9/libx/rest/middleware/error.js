module.exports = exports = adapter => exports.error.bind(adapter)

/**
 * @type {import('express').Handler}
 * @this import('../RestAdapter')
 */
exports.error = function (err, req, res, next) {
  if (!pass_through(err)) normalizeError(err, req, false)
  return next(err)
}

const { pass_through, normalizeError } = require('../../odata/middleware/error')
