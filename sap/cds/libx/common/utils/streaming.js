const cds = require('../../../lib')
const { Readable } = require('node:stream')

exports.validateMimetypeIsAcceptedOrThrow = (headers, contentType) => {
  if (!contentType || !headers?.accept) return
  if (headers.accept.includes('*/*')) return
  if (headers.accept.includes(contentType)) return
  if (headers.accept.includes(contentType.slice(0,contentType.indexOf('/')) + '/*')) return
  const msg = `Content type "${contentType}" is not listed in accept header "${headers.accept}"`
  throw Object.assign(new Error(msg), { statusCode: 406 })
}

// REVISIT: We should use express' res.type(...) instead of res.set('Content-Type', ...)
const _mimetypes = {
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
}

const { extname } = require('path')
const _mimetype4 = filename => {
  if (!filename) return
  const filetype = extname(filename).toLowerCase()
  return _mimetypes[filetype]
}

const _annotation = (def,a) => {
  if (!def) return
  if (typeof def[a] === 'string') return def[a]
}

// REVISIT: Such helpers are a pain -> use classes with methods instead, e.g. RestAdapter extends HttpAdapter, ODataAdapter extends RestAdapter, etc.
exports.collectStreamMetadata = (result, operation, query) => {
  const element = query?._propertyAccess ? cds.infer.target(query).elements?.[query._propertyAccess] : undefined
  const returns = operation?.returns

  const filename =
    result.$mediaContentDispositionFilename ?? // legacy -> support for odata only?
    result.filename ??
    _annotation (returns, '@Core.ContentDisposition.Filename')
    _annotation (element, '@Core.ContentDisposition.Filename')

  const disposition =
    result.$mediaContentDispositionType ?? // legacy -> support for odata only?
    _annotation (returns, '@Core.ContentDisposition.Type') ??
    _annotation (element, '@Core.ContentDisposition.Type') ??
    (filename ? 'attachment' : 'inline')

  const mimetype =
    result['*@odata.mediaContentType'] ??  // compat -> support for odata only?
    result.$mediaContentType ??           // legacy -> support for odata only?
    result.mimetype ??
    _mimetype4 (filename) ??
    _mimetype4 (result.path) ??         // e.g. for file downloads
    _annotation (returns, '@Core.MediaType') ??
    _annotation (element, '@Core.MediaType') ??
    'application/octet-stream' // REVISIT: or rather default to undefined?

  return { mimetype, filename, disposition }
}

exports.getReadable = function readable4 (result) {
  if (result == null) return
  if (typeof result !== 'object') {
    const stream = new Readable()
    stream.push(result)
    stream.push(null)
    return stream
  }
  if (result instanceof Readable) return result
  if (result.value) return readable4 (result.value) // REVISIT: for OData legacy only?
  if (Array.isArray(result)) return readable4 (result[0]) // compat // REVISIT: remove ?
}
