const { format, inspect } = require('../utils/cds-utils')


/**
 * Constructs and optionally throws an Error object.
 * Usage variants:
 *
 *       cds.error (404, 'Not Found', { code, ... })
 *       cds.error ('Not Found', { code, ... })
 *       cds.error ({ code, message, ... })
 *       cds.error `template string usage variant`
 *
 * When called with `new` the newly created Error is returned.
 * When called without `new` the error is thrown immediately.
 * The latter is useful for usages like that:
 *
 *       let x = y || cds.error `'y' must be truthy, got: ${y}`
 *
 * @param {number} [status] - HTTP status code
 * @param {string} [message] - Error message
 * @param {object} [details] - Additional error details
 * @param {Function} [caller] - The function calling this
 */
const error = exports = module.exports = function cds_error ( status, message, details, caller ) {
  if (typeof status !== 'number') [ status, message, details, caller ] = status.raw ? [ undefined, error.message(...arguments) ] : [ undefined, status, message, details ]
  if (typeof message === 'object') [ message, details, caller ] = [ undefined, message, details ]
  let err = details && 'stack' in details ? details : Object.assign (new Error (message, details), details)
  if (caller) Error.captureStackTrace (err, caller); else Error.captureStackTrace (err, error)
  if (status) Object.defineProperty (err, 'status', {value:status})
  if (new.target) return err
  else throw err
}


/**
 * Constructs a message from a tagged template string. In contrast to usual
 * template strings embedded values are formatted using `util.format`
 * not just `toString()`.
 *
 *     let x = `A sample message with ${'a string'}, ${{an:'object'}}, and ${[1,2,3]}`
 *     let y = cds.error.message`with ${'a string'}, ${{an:'object'}}, and ${[1,2,3]}`
 *     //> x = A sample message with a string and [object Object], and 1,2,3
 *     //> y = with a string, { an: 'object' }, and [ 1, 2, 3 ]
 */
exports.message = (strings,...values) => {
  return String.raw(strings,...values.map(v => format(v)))
}


/**
 * Use that to construct and throw errors from a tagged template string
 * in validations of function arguments.
 * Use it like that:
 *
 *     let x = {foo:'bar'}
 *     typeof x === 'string' || cds.error.expected `${{x}} to be a string`
 *     //> Error: Expected argument 'x' to be a string, but got: { foo: 'bar' }
 */
exports.expected = ([,type], arg) => {
  const [ name, value ] = Object.entries(arg)[0]
  return error (`Expected argument '${name}'${type}, but got: ${inspect(value)}`, undefined, error.expected)
}


exports.isSystemError = err => err.name in {
  TypeError:1,
  ReferenceError:1,
  SyntaxError:1,
  RangeError:1,
  URIError:1,
}


//
// Private helpers ...
//

exports._duplicate_cds = (...locations) => {
  const { local } = require('../utils/cds-utils')
  throw error `Duplicate @sap/cds/common!

  There are duplicate versions of @sap/cds loaded from these locations:

    ${locations.map(local).join('\n    ')}

  To fix this, check all dependencies to "@sap/cds" in your package.json and
  those of reused packages and ensure they allow deduped use of @sap/cds.
  `
}

exports._no_primary_db = new Proxy ({},{ get: function fn(_,p) { error (`Not connected to primary datasource!

  Attempt to use 'cds.${p}' without prior connect to primary datasource,
  i.e. cds.connect.to('db').
  ${ process.argv[1].endsWith('cds') && process.argv[2] in {run:1,serve:1} ? `
  Please configure one thru 'cds.requires.db' or use in-memory db:
  cds ${process.argv[2]} --in-memory` : ''}`

,{},fn) }})
