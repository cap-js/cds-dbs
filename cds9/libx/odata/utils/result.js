const METADATA = {
  $context: '@odata.context',
  $count: '@odata.count',
  $etag: '@odata.etag',
  $metadataEtag: '@odata.metadataEtag',
  $bind: '@odata.bind',
  $id: '@odata.id',
  $delta: '@odata.delta',
  $removed: '@odata.removed',
  $type: '@odata.type',
  $nextLink: '@odata.nextLink',
  $deltaLink: '@odata.deltaLink',
  $editLink: '@odata.editLink',
  $readLink: '@odata.readLink',
  $navigationLink: '@odata.navigationLink',
  $associationLink: '@odata.associationLink',
  $mediaEditLink: '@odata.mediaEditLink',
  $mediaReadLink: '@odata.mediaReadLink',
  $mediaContentType: '@odata.mediaContentType',
  $mediaContentDispositionFilename: '@odata.mediaContentDispositionFilename', // > not supported by okra
  $mediaContentDispositionType: '@odata.mediaContentDispositionType', // > not supported by okra
  $mediaEtag: '@odata.mediaEtag'
}

const KEYSTOCLEANUP = {
  // REVISIT: should probably be handled in RemoteService's handle()
  // do not set "@odata.context" as it may be inherited of remote service
  $context: true,
  // REVISIT: okra doesn't support content disposition
  $mediaContentDispositionFilename: true,
  $mediaContentDispositionType: true
}

const _rewriteMetadataDeep = result => {
  for (const key in result) {
    if (typeof result[key] === 'object' && result[key] != null) _rewriteMetadataDeep(result[key])
    if (key in METADATA && !KEYSTOCLEANUP[key]) {
      result[METADATA[key]] = result[key]
      delete result[key]
    }
  }
}

/**
 * Constructs the odata result object from the result of the service call as well as the provided metadata and additional options.
 *
 * @param {*} result - the result of the service call, i.e., the payload to return to the client
 * @param {object} metadata - odata metadata
 * @param {string} metadata.context - @odata.context
 * @param {object} [options] - additional options/ instructions
 * @param {boolean} [options.isCollection] - whether the result shall be a collection
 * @param {string} [options.property] - the name of the requested single property, if any
 * @returns {object} - the odata result
 */
module.exports = function getODataResult(result, metadata, options = {}) {
  if (result == null) return

  const { isCollection, property } = options

  if (isCollection && !Array.isArray(result)) result = [result]
  else if (!isCollection && Array.isArray(result)) result = result[0]

  if (result === undefined) return

  // make sure @odata.context is the first element (per OData spec)
  const odataResult = {
    [METADATA.$context]: metadata.context
  }

  // copy metadata from result to odataResult
  for (const key in METADATA) {
    if (!(key in result)) continue
    if (!KEYSTOCLEANUP[key]) odataResult[METADATA[key]] = result[key]
  }

  // rewrite metadata in result
  _rewriteMetadataDeep(result)

  // add result to odataResult
  if (isCollection) {
    Object.assign(odataResult, { value: result })
  } else if (property) {
    Object.assign(odataResult, { value: result[property] })
  } else {
    Object.assign(odataResult, result)
  }

  return odataResult
}
