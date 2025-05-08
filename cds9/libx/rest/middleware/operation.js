module.exports = exports = adapter => exports.operation.bind(adapter)

/**
 * @type {import('express').Handler}
 * @this import('../RestAdapter')
 */
exports.operation = async function (req, res) {
  const op = req._operation
  const request = this.request4({ event: op.name, data: req._data, params: req._params, req, res })

  // REVISIT: when/why is a query given for an operation? -> obsolete with req.subject?
  // REVISIT: when/why are op.names prefixed with service name? -> looks like OData impact?
  if (req._query) request.query = req._query
  else request.event = op.name.replace(`${this.service.namespace}.`, '')

  // Send the request to the service to be handled
  const result = await this.service.dispatch(request)

  // Quick checks if theres anything left to do
  if (res.headersSent) return // response already sent by the service
  if (!op.returns || result == null) return { status: 204 }

  // Handle special cases
  if (result instanceof Readable || (op.returns._type === 'cds.LargeBinary' && 'value' in result))
    return _stream(result, req, res)

  // Set content type if not already set
  if (!res.get('Content-Type'))
    res.set('Content-Type', op.returns._type === 'cds.String' ? 'text/plain' : 'application/json')

  // Done
  return { result }
}

function _stream(result, req, res) {
  const stream = streaming.getReadable(result)
  if (!stream) return res.sendStatus(204)

  const { mimetype, filename, disposition } = streaming.collectStreamMetadata(result, req._operation, req._query)
  streaming.validateMimetypeIsAcceptedOrThrow(req.headers, mimetype)

  if (mimetype && !res.get('Content-Type')) res.set('Content-Type', mimetype)
  if (filename && !res.get('Content-Disposition'))
    res.set('Content-Disposition', `${disposition}; filename="${filename}"`)
  return pipeline(stream, res)
}

const { pipeline } = require('node:stream/promises')
const { Readable } = require('node:stream')
const streaming = require('../../common/utils/streaming')
