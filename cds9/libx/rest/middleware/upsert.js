module.exports = exports = adapter => exports.upsert.bind(adapter)

/**
 * @type {import('express').Handler}
 * @this import('../RestAdapter')
 */
// prettier-ignore
exports.upsert = function (req, res) {
  // add default values for unprovided properties
  if (req.method === 'PUT') prepare_put_requests(this.service, cds.infer.target(req._query), req._data)

  return update.call(this, req, res)
    .catch(e => {
      if (!retry(e, req)) throw e

      req.method = 'POST'
      const { entity } = req._query.UPDATE
      const { keys } = getKeysAndParamsFromPath(entity, { model: this.service.model })
      const data = (req.body = JSON.parse(req._raw)) // REVISIT: eliminate req._raw
      req._data = Object.assign(data, keys)          // REVISIT: eliminate req._data
      req._query = INSERT.into(entity)               // REVISIT: eliminate req._query
      return create.call(this, req, res)             // REVISIT: Changed from calling router.handle() which is undocumented!
    })
}

const cds = require('../../_runtime/cds')

const { update } = require('./update')
const { create } = require('./create')

const prepare_put_requests = require('../../http/put')

const { getKeysAndParamsFromPath } = require('../../common/utils/path')

// REVISIT: we really need to eliminate this code || status || statusCode mess w/ cds9!
const retry = (e, req) => is404(e) || (is412(e) && req.get('if-none-match') === '*')
const is404 = e => e.code === 404 || e.status === 404 || e.statusCode === 404
const is412 = e => e.code === 412 || e.status === 412 || e.statusCode === 412
