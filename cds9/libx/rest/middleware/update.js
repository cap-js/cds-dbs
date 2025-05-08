module.exports = exports = adapter => exports.update.bind(adapter)

/**
 * @type {import('express').Handler}
 * @this import('../RestAdapter')
 */
// prettier-ignore
exports.update = async function (req, res) {
  const request = this.request4({
    req, res,                         // REVISIT: should go into cds.Request
    method: req.method,               // REVISIT: should go into cds.Request
    params: req._params,              // REVISIT: eliminate req._params
    query: req._query.data(req._data) // REVISIT: eliminate req._query, req._data
  })
  const result = await this.service.send(request)
  return { result }
}
