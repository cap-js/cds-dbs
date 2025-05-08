const cds = require('../../cds')

module.exports = exports = cds.service.impl(function () {
  this.before('READ', '*', handle_paging)
})

const DEFAULT = cds.env.query?.limit?.default ?? 1000
const MAX = cds.env.query?.limit?.max ?? 1000
const _cached = Symbol('@cds.query.limit')

const getPageSize = def => {
  // do not look at prototypes re cached settings
  if (Object.hasOwn(def, _cached)) return def[_cached]
  let max = def['@cds.query.limit.max'] ?? def._service?.['@cds.query.limit.max'] ?? MAX
  let _default =
    def['@cds.query.limit.default'] ??
    def['@cds.query.limit'] ??
    def._service?.['@cds.query.limit.default'] ??
    def._service?.['@cds.query.limit'] ??
    DEFAULT
  if (!max) max = Number.MAX_SAFE_INTEGER
  if (!_default || _default > max) _default = max
  return def.set(_cached, { default: _default, max })
}

const handle_paging = function (req) {
  // only if http request
  if (!req.http?.req) return

  // target === null if view with parameters
  if (!req.target || !req.query?.SELECT || req.query.SELECT.one) return

  _addPaging(req.query, req.target)
}

const _addPaging = function ({ SELECT }, target) {
  if (SELECT.limit === null) return
  const { rows } = SELECT.limit || (SELECT.limit = {})
  const conf = getPageSize(target)
  SELECT.limit.rows = {
    val: !rows ? conf.default : Math.min(rows.val ?? rows, conf.max)
  }
  //Handle nested limits
  if (SELECT.from.SELECT?.limit) _addPaging(SELECT.from, target)
}
handle_paging._initial = true

// needed in lean draft
exports.getPageSize = getPageSize
exports.commonGenericPaging = handle_paging
