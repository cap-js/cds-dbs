/** @typedef {import('../../lib/srv/cds.Service')} Service */

const cds = require('../../')
const { decodeURIComponent } = cds.utils

const odata2cqn = require('./parse/parser').parse
const cqn2odata = require('./parse/cqn2odata')

const afterburner = require('./parse/afterburner')
const { getSafeNumber: safeNumber } = require('./utils')

// used for function validation in peggy parser
// -----  should all be lowercase, as peggy compares to lowercase  -----
// (plus: odata is case insensitive)
const strict = {
  functions: {
    // --- String + Collection: https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part2-url-conventions.html#_Toc31360980
    concat: 1,
    contains: 1,
    endswith: 1,
    indexof: 1,
    length: 1,
    startswith: 1,
    substring: 1,
    // --- Collection: https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part2-url-conventions.html#_Toc31360988
    // REVISIT: not supported
    // hassubset:1,
    // hassubsequence:1,
    // --- String: https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part2-url-conventions.html#_Toc31360991
    matchespattern: 1,
    tolower: 1,
    toupper: 1,
    trim: 1,
    // --- Date + Time: https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part2-url-conventions.html#_Toc31360996
    date: 1,
    day: 1,
    fractionalseconds: 1,
    hour: 1,
    maxdatetime: 1,
    mindatetime: 1,
    minute: 1,
    month: 1,
    now: 1,
    second: 1,
    time: 1,
    totaloffsetminutes: 1,
    totalseconds: 1,
    year: 1,
    // --- Arithemetic: https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part2-url-conventions.html#_Toc31361011
    ceiling: 1,
    floor: 1,
    round: 1,
    // --- Type: https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part2-url-conventions.html#_Toc31361015
    // REVISIT: not supported
    // cast: 1,
    // REVISIT: has to be implemented inside the odata adapter
    // isof: 1,
    // --- Geo: https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part2-url-conventions.html#_Toc31361018
    // REVISIT: not supported
    // 'geo.distance': 1,
    // 'geo.intersects': 1,
    // 'geo.length': 1,
    // --- Conditional: https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part2-url-conventions.html#_Toc31361022
    case: 1
  }
}

const _enhanceCqn = (cqn, options) => {
  if (options.afterburner) {
    /** @type Service */ const service = options.service
    let { model, namespace } = service
    if (service.isExtensible) model = cds.context?.model || model
    cqn = options.afterburner(cqn, model, namespace, options.protocol)
  }

  const query = cds.ql(cqn)

  // REVISIT: _target vs __target, i.e., pseudo csn vs actual csn
  // DO NOT USE __target outside of libx/rest!!!
  if (options.protocol === 'rest' && cqn.__target) query.__target = cqn.__target

  if (cqn._propertyAccess)
    Object.defineProperty(query, '_propertyAccess', { value: cqn._propertyAccess, enumerable: false })

  return query
}

/*
 * cds.odata API
 */
module.exports = {
  parse: (url, options = {}) => {
    // first arg may also be req
    if (url.url) url = url.url

    url = decodeURIComponent(url)

    // REVISIT: compat for bad url in mtxs tests (cf. #957)
    if (url.match(/\?\?/)) {
      const split = url.split('?')
      url = split.shift() + '?'
      while (split[0] === '') split.shift()
      url += split.join('?')
    }

    options = options === 'strict' ? { strict } : options.strict ? { ...options, strict } : options
    if (options.service?.model) Object.assign(options, { minimal: true, afterburner })
    options.safeNumber = safeNumber
    options.skipToken = require('./utils').skipToken

    let cqn
    try {
      cqn = odata2cqn(url, options)
    } catch (err) {
      if (err.statusCode === 501) throw new cds.error(err.statusCode, err.message)

      let offset = err.location && err.location.start.offset
      if (!offset && err.statusCode && err.message) throw err

      // we need to add the number of chars from base url to the offset
      offset += options.baseUrl ? options.baseUrl.length : 0

      // TODO adjust this to behave like above
      err.message = `Parsing URL failed at position ${offset}: ${err.message}`
      err.statusCode = err.statusCode || 400
      throw err
    }

    // cqn is an array, if concat is used
    if (Array.isArray(cqn)) {
      for (let i = 0; i < cqn.length; i++) cqn[i] = _enhanceCqn(cqn[i], options)
    } else {
      cqn = _enhanceCqn(cqn, options)
    }

    // REVISIT: SELECT.from._params is a temporary hack
    if (cqn.SELECT?.from?._params) delete cqn.SELECT.from._params

    return cqn
  },

  urlify: (cqn, options = {}) => {
    return cqn2odata(cqn, options)
  }
}
