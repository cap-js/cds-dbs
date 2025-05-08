const cds = require('../../../')
const { UPDATE, DELETE } = cds.ql

const { handleSapMessages, getPreferReturnHeader } = require('../utils')

const { getKeysAndParamsFromPath } = require('../../common/utils/path')

module.exports = adapter => {
  const { service } = adapter

  return function deleet(req, res, next) {
    if (getPreferReturnHeader(req)) {
      const msg = "The 'return' preference is not allowed in DELETE requests"
      throw Object.assign(new Error(msg), { statusCode: 400 })
    }

    // REVISIT: better solution for query._propertyAccess
    const {
      SELECT: { one, from },
      _propertyAccess
    } = req._query

    if (!one) {
      throw Object.assign(new Error('Method DELETE is not allowed for entity collections'), { statusCode: 405 })
    }

    const model = cds.context.model ?? service.model

    // payload & params
    const { keys, params } = getKeysAndParamsFromPath(from, { model })
    const data = keys //> for read and delete, we provide keys in req.data
    if (_propertyAccess) data[_propertyAccess] = null //> delete of property -> set to null

    // query
    const query = _propertyAccess ? UPDATE(from).set({ [_propertyAccess]: null }) : DELETE.from(from)

    // cdsReq.headers should contain merged headers of envelope and subreq
    const headers = { ...cds.context.http.req.headers, ...req.headers }

    // we need a cds.Request for multiple reasons, incl. params, headers, sap-messages, read after write, ...
    const cdsReq = adapter.request4({ query, data, headers, params, req, res })

    // NOTES:
    // - only via srv.run in combination with srv.dispatch inside,
    //   we automatically either use a single auto-managed tx for the req (i.e., insert and read after write in same tx)
    //   or the auto-managed tx opened for the respective atomicity group, if exists
    // - in the then block of .run(), the transaction is committed (i.e., before sending the response) if a single auto-managed tx is used
    return service
      .run(() => {
        return service.dispatch(cdsReq).then(result => {
          // nothing to do
          return result
        })
      })
      .then(() => {
        if (res.headersSent) return

        handleSapMessages(cdsReq, req, res)

        res.sendStatus(204)
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
