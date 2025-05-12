const cds = require('../../lib')
module.exports = cds

/*
 * csn aspects
 */
const { any, entity, Association, service } = cds.builtin.classes
cds.extend(any).with(require('./common/aspects/any'))
cds.extend(Association).with(require('./common/aspects/Association'))
cds.extend(entity).with(require('./common/aspects/entity'))
cds.extend(service).with(require('./common/aspects/service'))

/*
 * Determines whether a request requires resolving of the target entity.
 * Added to cds.Service so it can be reused in cds.ApplicationService and cds.RemoteService.
 */
cds.Service.prototype._requires_resolving = function (req) {
  if (req._resolved) return false
  if (!this.model) return false
  if (!req.query || typeof req.query !== 'object') return false
  if (Array.isArray(req.query)) return false
  if (Object.keys(req.query).length === 0) return false
  if (req.target?.name?.startsWith(this.definition?.name + '.')) return false
  else return true
}

// FIXME: move resolve out of cds.ql !
const resolve = require('../../lib/ql/resolve')
cds.Service.prototype.resolve = function (query) {
  return resolve(query, this)
}
