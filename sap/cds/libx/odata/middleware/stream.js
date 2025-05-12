const cds = require('../../../')
const LOG = cds.log('odata')
const { pipeline } = require('node:stream/promises')

const { handleSapMessages, validateIfNoneMatch, isStream, isRedirect } = require('../utils')
const { getKeysAndParamsFromPath } = require('../../common/utils/path')
const {
  collectStreamMetadata,
  validateMimetypeIsAcceptedOrThrow,
  getReadable
} = require('../../common/utils/streaming')

const _resolveContentProperty = (target, annotName, resolvedProp) => {
  if (target.elements[resolvedProp]) {
    return resolvedProp
  }
  LOG._warn &&
    LOG.warn(
      `"${annotName}" in entity "${target.name}" points to property "${resolvedProp}" which was renamed or is not part of the projection. You must update the annotation value.`
    )
  // REVISIT: do not allow renaming of content type property. always rely on compiler resolving.
  const mapping = cds.ql.resolve.transitions({ _target: target }, cds.db).mapping
  const key = [...mapping.entries()].find(({ 1: val }) => val.ref[0] === resolvedProp)
  return key?.length && key[0]
}

const _addMetadataProperty = (query, property, annotName, odataName) => {
  if (typeof property[annotName] === 'object') {
    const contentProperty = _resolveContentProperty(
      query._target,
      annotName,
      property[annotName]['='].replaceAll(/\./g, '_')
    )
    query._target.elements[contentProperty]
      ? query.SELECT.columns.push({ ref: [contentProperty], as: odataName })
      : LOG._warn &&
        LOG.warn(`"${annotName.split('.')[1]}" ${contentProperty} not found in entity "${query._target.name}".`)
  } else {
    query.SELECT.columns.push({ val: property[annotName], as: odataName })
  }
}

const _addStreamMetadata = query => {
  // new odata parser sets streaming property in SELECT.from
  const ref = query.SELECT.columns?.[0].ref || query.SELECT.from.ref
  const propertyName = ref.at(-1)
  let mediaTypeProperty
  for (let key in query._target.elements) {
    const val = query._target.elements[key]
    if (val['@Core.MediaType'] && val.name === propertyName) {
      mediaTypeProperty = val
      break
    }
  }

  _addMetadataProperty(query, mediaTypeProperty, '@Core.MediaType', '$mediaContentType')

  if (mediaTypeProperty['@Core.ContentDisposition.Filename']) {
    _addMetadataProperty(
      query,
      mediaTypeProperty,
      '@Core.ContentDisposition.Filename',
      '$mediaContentDispositionFilename'
    )
  }

  if (mediaTypeProperty['@Core.ContentDisposition.Type']) {
    query.SELECT.columns.push({
      val: mediaTypeProperty['@Core.ContentDisposition.Type'],
      as: '$mediaContentDispositionType'
    })
  }
}

module.exports = adapter => {
  const { service } = adapter

  return function stream(req, res, next) {
    const { _query: query } = req

    // $apply with concat -> multiple queries with special handling -> read only, no stream?
    if (Array.isArray(query)) return next()

    if (isRedirect(query)) {
      const cdsReq = adapter.request4({ query, req, res })

      return service.dispatch(cdsReq).then(result => {
        if (result[query._propertyAccess]) res.set('Location', result[query._propertyAccess])
        return res.sendStatus(307)
      })
    }

    const [previous, lastPathElement] = req.path.split('/').slice(-2)
    const _isStreamByDollarValue =
      query.SELECT?.one && lastPathElement === '$value' && !(previous in cds.infer.target(query).elements) // FIXME: cds.infer should not be used before ensure_target / srv.dispatch
    if (_isStreamByDollarValue) {
      for (const k in query._target.elements) {
        if (query._target.elements[k]['@Core.MediaType']) {
          query.SELECT.columns = [{ ref: [k] }]
          query._propertyAccess = k
          break
        }
      }
    }

    const pdfMimeType = !!req.headers.accept?.match(/application\/pdf/)
    const isMimeTypeStreamedByDefault = !!(!query.SELECT.one && pdfMimeType)
    const _isStream = isStream(query) || _isStreamByDollarValue || isMimeTypeStreamedByDefault

    if (!_isStream) return next()

    if (!query._target['@cds.persistence.skip'] && !isMimeTypeStreamedByDefault) {
      _addStreamMetadata(query)
    }

    // for read and delete, we provide keys in req.data
    // payload & params
    const { keys, params } = getKeysAndParamsFromPath(query.SELECT.from, service)

    // we need the cds request, so we can access the modified query, which is cloned due to lean-draft, so we need to use dispatch here and pass a cds req
    const cdsReq = adapter.request4({ query, data: keys, params, req, res })

    // NOTES:
    // - only via srv.run in combination with srv.dispatch inside,
    //   we automatically either use a single auto-managed tx for the req (i.e., insert and read after write in same tx)
    //   or the auto-managed tx opened for the respective atomicity group, if exists
    // - in the then block of .run(), the transaction is committed (i.e., before sending the response) if a single auto-managed tx is used
    return service
      .run(() => {
        return service.dispatch(cdsReq).then(async result => {
          if (res.headersSent) return
          if (result === undefined) throw new cds.error(404) // entity is not existing
          if (result === null) return res.sendStatus(204) // custom handler returns null

          if (validateIfNoneMatch(cdsReq.target, req.headers?.['if-none-match'], result)) return res.sendStatus(304)

          const { mimetype, filename, disposition } = collectStreamMetadata(result, undefined, query)
          if (pdfMimeType && !mimetype) result.mimetype = 'application/pdf' // REVISIT: Is compat still needed?

          // REVISIT: If accessed property is undefined - why prevent 404?
          if (query._propertyAccess && result[query._propertyAccess] !== undefined) {
            result = result[query._propertyAccess]
          } else if (lastPathElement === '$value') {
            // Implicit streaming
            const property = Object.values(query.target.elements).find(
              el => el.type === 'cds.LargeBinary' && result[el.name] !== undefined
            )
            result = property && result[property.name]
          }

          const stream = getReadable(result)
          if (!stream) return res.sendStatus(204)

          validateMimetypeIsAcceptedOrThrow(req.headers, mimetype)
          if (!res.get('content-type')) res.set('content-type', mimetype)
          if (filename && !res.get('content-disposition'))
            res.set('content-disposition', `${disposition}; filename="${encodeURIComponent(filename)}"`)

          return pipeline(stream, res)
        })
      })
      .then(() => {
        if (res.headersSent) return

        handleSapMessages(cdsReq, req, res)

        res.end()
      })
      .catch(err => {
        handleSapMessages(cdsReq, req, res)

        next(err)
      })
  }
}
