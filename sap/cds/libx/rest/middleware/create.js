module.exports = exports = adapter => exports.create.bind(adapter)

/**
 * @type {import('express').Handler}
 * @this import('../RestAdapter')
 */
exports.create = async function (req, res) {
  const { _query: query, _data, _params: params } = req

  let result, location

  // add the data
  query.entries(_data)

  if (query.INSERT.entries.length > 1) {
    // > batch insert
    const cdsReqs = query.INSERT.entries.map(entry => {
      return this.request4({ query: INSERT.into(query.INSERT.into).entries(entry), params, req, res })
    })
    const ress = await Promise.allSettled(cdsReqs.map(req => this.service.dispatch(req)))
    const rejected = ress.filter(r => r.status === 'rejected')
    if (rejected.length) throw _error4(rejected)
    result = ress.map(r => r.value)
  } else {
    // > single insert
    const cdsReq = this.request4({ query, params, req, res })
    result = await this.service.dispatch(cdsReq)
    location = location4(cdsReq.target, this.service, result, true)
  }

  return { result, status: 201, location }
}

const cds = require('../../_runtime/cds')
const { INSERT } = cds.ql

const location4 = require('../../http/location')

const _error4 = rejected =>
  rejected.length > 1
    ? Object.assign(new Error('MULTIPLE_ERRORS'), { details: rejected.map(r => r.reason) })
    : rejected[0].reason
