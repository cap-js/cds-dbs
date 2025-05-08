const { performance } = require ('perf_hooks')

module.exports = (prec = 1000) => function sap_statistics (req, res, next) {
  if (req.query['sap-statistics'] || req.headers['sap-statistics']) {
    const { writeHead } = res, t0 = performance.now()
    res.writeHead = function (...args) {
      const total = ((performance.now() - t0) / prec).toFixed(2)
      if (res.statusCode < 400) res.setHeader('sap-statistics', `total=${total}`)
      writeHead.call(this, ...args)
    }
  }
  next()
}
