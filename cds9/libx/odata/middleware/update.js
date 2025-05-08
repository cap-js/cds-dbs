const cds = require('../../../')
const { UPDATE } = cds.ql

const { handleSapMessages, getPreferReturnHeader, extractIfNoneMatch, isStream } = require('../utils')
const getODataMetadata = require('../utils/metadata')
const postProcess = require('../utils/postProcess')
const readAfterWrite4 = require('../utils/readAfterWrite')
const getODataResult = require('../utils/result')
const normalizeTimeData = require('../utils/normalizeTimeData')
const odataBind = require('../utils/odataBind')

const { getKeysAndParamsFromPath } = require('../../common/utils/path')

const prepare_put_requests = require('../../http/put')

// Not supported:
// 1) If some parent entity needs to be updated, reason: we only generate one CQN statement for the target.
// 2) If the foreign key is not known, i.e. when having no key information of the immediate parent, e.g. /Root(1)/foo/bar
const upsertSupported = (pathExpression, model) => {
  const pathExpressionRef = pathExpression?.ref

  // not a navigation
  if (pathExpressionRef.length < 2) return true

  // foreign key is not known
  if (!pathExpressionRef[pathExpressionRef.length - 2].where) return false

  let currentEntity = model.definitions[pathExpressionRef[0].id]
  let navElement

  for (let i = 1; i < pathExpressionRef.length; i++) {
    const id = typeof pathExpressionRef[i] === 'string' ? pathExpressionRef[i] : pathExpressionRef[i].id
    navElement = currentEntity.elements[id]
    currentEntity = navElement._target
  }

  // disallow processing of requests along associations to one and containments
  if (!navElement.is2one || navElement._isContained) return true

  return navElement._foreignKeys.every(foreignKey => foreignKey.parentElement.key)
}

module.exports = adapter => {
  const { service } = adapter
  const _readAfterWrite = readAfterWrite4(adapter, 'update')

  return function update(req, res, next) {
    // REVISIT: better solution for _propertyAccess
    const {
      SELECT: { one, from },
      _propertyAccess
    } = req._query

    // REVISIT: patch on collection is allowed in odata 4.01
    if (!one) {
      throw Object.assign(new Error(`Method ${req.method} is not allowed for entity collections`), { statusCode: 405 })
    }

    const _isStream = isStream(req._query)

    if (_propertyAccess && req.method === 'PATCH' && !_isStream) {
      throw Object.assign(new Error(`Method ${req.method} is not allowed for properties`), { statusCode: 405 })
    }

    const model = cds.context.model ?? service.model

    // payload & params
    const target = cds.infer.target(req._query) // FIXME: this should not happen here but only in an event handler !
    const data = _propertyAccess ? { [_propertyAccess]: req.body.value } : req.body
    odataBind(data, target)
    normalizeTimeData(data, model, target)
    const { keys, params } = getKeysAndParamsFromPath(from, { model })
    if (!_propertyAccess) {
      // add keys from url into payload (overwriting if already present)
      Object.assign(data, keys)
      // add default values for unprovided properties
      if (req.method === 'PUT') prepare_put_requests(service, target, data)
    }

    // query
    const query = UPDATE.entity(from).with(data)

    // cdsReq.headers should contain merged headers of envelope and subreq
    // REVISIT: this overrides the merging mechanism in cds.Request which is meant to handle this centrally !!
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
          // If minimal requested or property access and not etag, skip read after write
          if (
            cdsReq._.readAfterWrite &&
            (target._etag || (!_propertyAccess && getPreferReturnHeader(req) !== 'minimal'))
          )
            return _readAfterWrite(cdsReq)
          return result
        })
      })
      .then(result => {
        if (res.headersSent) return

        handleSapMessages(cdsReq, req, res)

        // case: read after write returns no results, e.g., due to auth (academic but possible)
        if (result == null) return res.sendStatus(204)

        const preference = getPreferReturnHeader(req)
        postProcess(cdsReq.target, model, result, preference === 'minimal')

        if (result?.$etag) res.set('ETag', result.$etag) //> must be done after post processing

        if (preference === 'minimal') res.append('Preference-Applied', 'return=minimal')
        else if (preference === 'representation') res.append('Preference-Applied', 'return=representation')
        if (preference === 'minimal' || (_propertyAccess && result[_propertyAccess] == null) || isStream(req._query)) {
          return res.sendStatus(204)
        }

        const metadata = getODataMetadata(_propertyAccess ? req._query : query, { result })
        result = getODataResult(result, metadata, { property: _propertyAccess })
        res.send(result)
      })
      .catch(err => {
        handleSapMessages(cdsReq, req, res)

        // if UPSERT is allowed, redirect to POST
        const is404 = err.code === 404 || err.status === 404 || err.statusCode === 404
        const isForcedInsert =
          (err.code === 412 || err.status === 412 || err.statusCode === 412) &&
          extractIfNoneMatch(req.headers?.['if-none-match']) === '*'
        const isUpsertAllowed = req.method === 'PUT' || cds.env.runtime.patch_as_upsert
        if (!_propertyAccess && (is404 || isForcedInsert) && isUpsertAllowed) {
          // PUT / PATCH with if-match header means "only if already exists" -> no insert if it does not
          if (req.headers['if-match']) return next(Object.assign(new Error('412'), { statusCode: 412 }))

          if (!upsertSupported(from, model)) return next(Object.assign(new Error('422'), { statusCode: 422 }))

          // -> forward to POST
          req.method = 'POST'
          req.body = JSON.parse(req._raw) // REVISIT: Why do we need that?
          return next()
        }

        // REVISIT: invoke service.on('error') for failed batch subrequests
        if (cdsReq.http.req.path.startsWith('/$batch') && service.handlers._error.length) {
          for (const each of service.handlers._error) each.handler.call(service, err, cdsReq)
        }

        // continue with caught error
        next(err)
      })
  }
}
