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
    location = location4(cdsReq.target, this.service, result)
  }

  return { result, status: 201, location }
}

const cds = require('../../_runtime/cds')
const { INSERT } = cds.ql

// REVISIT:
// - use shared require('../../http/location')
// - i believe the leading "../" is incorrect
const location4 = (target, srv, result) => {
  let location = `../${target.name.replace(srv.definition.name + '.', '')}`
  for (const k in target.keys) location += `/${result[k]}`
  return location
}

const _error4 = rejected =>
  rejected.length > 1
    ? Object.assign(new Error('MULTIPLE_ERRORS'), { details: rejected.map(r => r.reason) })
    : rejected[0].reason
