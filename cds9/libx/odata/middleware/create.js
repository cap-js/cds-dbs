const cds = require('../../../')
const { INSERT } = cds.ql

const { handleSapMessages, getPreferReturnHeader } = require('../utils')
const getODataMetadata = require('../utils/metadata')
const postProcess = require('../utils/postProcess')
const readAfterWrite4 = require('../utils/readAfterWrite')
const getODataResult = require('../utils/result')
const normalizeTimeData = require('../utils/normalizeTimeData')
const odataBind = require('../utils/odataBind')

const location4 = require('../../http/location')

const { getKeysAndParamsFromPath } = require('../../common/utils/path')

module.exports = (adapter, isUpsert) => {
  // REVISIT: adapter should be this
  const { service } = adapter
  const _readAfterWrite = readAfterWrite4(adapter, 'create')

  return function create(req, res, next) {
    const {
      SELECT: { one, from }
    } = req._query

    if (one && !isUpsert) {
      const msg = 'Method POST is not allowed for singletons and individual entities'
      throw Object.assign(new Error(msg), { statusCode: 405 })
    }

    const model = cds.context.model ?? service.model

    // payload & params
    const target = cds.infer.target(req._query) // FIXME: this should not happen here but only in an event handler !
    const data = req.body
    if (Array.isArray(data)) {
      const msg = 'Only single entity representations are allowed'
      throw Object.assign(new Error(msg), { statusCode: 400 })
    }
    odataBind(data, target)
    normalizeTimeData(data, model, target)
    const { keys, params } = getKeysAndParamsFromPath(from, { model })
    // add keys from url into payload (overwriting if already present)
    Object.assign(data, keys)

    // query
    const query = INSERT.into(from).entries(data)

    // cdsReq.headers should contain merged headers of envelope and subreq
    const headers = { ...cds.context.http.req.headers, ...req.headers }

    // we need a cds.Request for multiple reasons, incl. params, headers, sap-messages, read after write, ...
    const cdsReq = adapter.request4({ query, params, headers, req, res })

    // NOTES:
    // - only via srv.run in combination with srv.dispatch inside,
    //   we automatically either use a single auto-managed tx for the req (i.e., insert and read after write in same tx)
    //   or the auto-managed tx opened for the respective atomicity group, if exists
    // - in the then block of .run(), the transaction is committed (i.e., before sending the response) if a single auto-managed tx is used
    return service
      .run(() => {
        return service.dispatch(cdsReq).then(result => {
          // cdsReq._.readAfterWrite is only true if generic handler served the request
          // If minimal requested and not etag, skip read after write
          if (cdsReq._.readAfterWrite && (target._etag || getPreferReturnHeader(req) !== 'minimal'))
            return _readAfterWrite(cdsReq)
          return result
        })
      })
      .then(result => {
        if (res.headersSent) return

        handleSapMessages(cdsReq, req, res)

        if (!target._isSingleton) {
          res.set('location', location4(cdsReq.target, service, result || cdsReq.data))
        }

        // case: read after write returns no results, e.g., due to auth (academic but possible)
        if (result == null) return res.sendStatus(204)

        const preference = getPreferReturnHeader(req)
        postProcess(cdsReq.target, model, result, preference === 'minimal')
        if (result?.$etag) res.set('ETag', result.$etag) //> must be done after post processing
        if (preference === 'minimal') return res.append('Preference-Applied', 'return=minimal').sendStatus(204)
        else if (preference === 'representation') res.append('Preference-Applied', 'return=representation')

        const metadata = getODataMetadata(query, { result })
        result = getODataResult(result, metadata)
        res.status(201).send(result)
      })
      .catch(err => {
        handleSapMessages(cdsReq, req, res)

        // REVISIT: invoke service.on('error') for failed batch subrequests
        if (cdsReq.http.req.path.startsWith('/$batch') && service.handlers._error.length) {
          for (const each of service.handlers._error) each.handler.call(service, err, cdsReq)
        }

        next(err)
      })
  }
}
