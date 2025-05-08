const cds = require('../../../')

module.exports = adapter => {
  const { service } = adapter

  return function odata_parse_url(req, _, next) {
    // REVISIT: can't we register the batch handler before the parse handler to avoid this?
    if (req.path.startsWith('/$batch')) return next()

    if (req._query) return next() //> already parsed (e.g., upsert)

    req._query = cds.odata.parse(req.url, { service, baseUrl: req.baseUrl, strict: true, protocol: 'odata' })

    next()
  }
}
