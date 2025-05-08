const cds = require('../../cds')
const LOG = cds.log('remote')
const { getCloudSdk } = require('./cloudSdkProvider')

const SANITIZE_VALUES = process.env.NODE_ENV === 'production' && cds.env.log.sanitize_values !== false
const { convertV2ResponseData, deepSanitize, convertV2PayloadData } = require('./data')

const KINDS_SUPPORTING_BATCH = { odata: true, 'odata-v2': true, 'odata-v4': true }

const _sanitizeHeaders = headers => {
  // REVISIT: is this in-place modification intended?
  if (headers?.authorization) headers.authorization = headers.authorization.split(' ')[0] + ' ***'
  return headers
}

const _executeHttpRequest = async ({ requestConfig, destination, destinationOptions, jwt }) => {
  const { executeHttpRequestWithOrigin } = getCloudSdk()

  if (typeof destination === 'string') {
    destination = {
      destinationName: destination,
      ...destinationOptions,
      ...{ jwt: destinationOptions?.jwt === undefined ? jwt : destinationOptions.jwt }
    }
    if (destination.jwt !== undefined && !destination.jwt) delete destination.jwt // don't pass any value
  } else if (destination.forwardAuthToken) {
    destination = {
      ...destination,
      headers: destination.headers ? { ...destination.headers } : {},
      authentication: 'NoAuthentication'
    }
    delete destination.forwardAuthToken
    if (jwt) destination.headers.authorization = `Bearer ${jwt}`
    else LOG._warn && LOG.warn('Missing JWT token for forwardAuthToken')
  }

  // Cloud SDK throws error if useCache is activated and jwt is undefined
  if (destination.jwt === undefined) destination.useCache = false

  if (LOG._debug) {
    const req2log = { headers: _sanitizeHeaders({ ...requestConfig.headers }) }
    if (requestConfig.method !== 'GET' && requestConfig.method !== 'DELETE')
      // In case of auto batch (only done for `GET` requests) no data is part of batch and for debugging URL is crucial
      req2log.data =
        requestConfig.data && SANITIZE_VALUES && !requestConfig._autoBatchedGet
          ? deepSanitize(requestConfig.data)
          : requestConfig.data
    LOG.debug(
      `${requestConfig.method} ${destination.url || `<${destination.destinationName}>`}${requestConfig.url}`,
      req2log
    )
  }

  // cloud sdk requires a new mechanism to differentiate the priority of headers
  // "custom" keeps the highest priority as before
  const maxBodyLength = cds.env?.remote?.max_body_length
  requestConfig = {
    ...requestConfig,
    headers: { custom: { ...requestConfig.headers } },
    ...(maxBodyLength && { maxBodyLength })
  }

  // set `fetchCsrfToken` to `false` because we mount a custom CSRF middleware
  const requestOptions = { fetchCsrfToken: false }

  return executeHttpRequestWithOrigin(destination, requestConfig, requestOptions)
}

/**
 * Rest Client
 */

/**
 * Normalizes server path.
 *
 * Adds / in the beginning of the path if not exists.
 * Removes / in the end of the path if exists.
 *
 * @param {*} path - to be normalized
 */
const formatPath = path => {
  let formattedPath = path
  if (!path.startsWith('/')) {
    formattedPath = `/${formattedPath}`
  }

  if (path.endsWith('/')) {
    formattedPath = formattedPath.substring(0, formattedPath.length - 1)
  }

  return formattedPath
}

function _defineProperty(obj, property, value) {
  const props = {}
  if (Array.isArray(obj)) {
    const _map = obj.map
    const map = (..._) => _defineProperty(_map.call(obj, ..._), property, value)
    props.map = { value: map, enumerable: false, configurable: true, writable: true }
  }

  props[property] = { value: value, enumerable: false, configurable: true, writable: true }
  for (const prop in props) {
    Object.defineProperty(obj, prop, props[prop])
  }

  return obj
}

function _normalizeMetadata(prefix, data, results) {
  const target = results !== undefined ? results : data
  if (typeof target !== 'object' || target === null) return target
  const metadataKeys = Object.keys(data).filter(k => prefix.test(k))

  for (const k of metadataKeys) {
    const $ = k.replace(prefix, '$')
    _defineProperty(target, $, data[k])
    delete target[k]
  }

  if (Array.isArray(target)) {
    return target.map(row => _normalizeMetadata(prefix, row))
  }

  // check properties for all and prop.results for odata v2
  for (const [key, value] of Object.entries(target)) {
    if (value && typeof value === 'object') {
      const nestedResults = (Array.isArray(value.results) && value.results) || value
      target[key] = _normalizeMetadata(prefix, value, nestedResults)
    }
  }

  return target
}

const _getPurgedRespActionFunc = (data, returnType) => {
  // return type is primitive value or inline/complex type
  if (returnType.kind === 'type' && !returnType.items && Object.values(data).length === 1) {
    for (const key in data) {
      return data[key]
    }
  }

  return data
}

const _purgeODataV2 = (data, target, returnType) => {
  if (typeof data !== 'object' || !data.d) return data

  data = returnType ? _getPurgedRespActionFunc(data.d, returnType) : data.d
  const purgedResponse = typeof data === 'object' && 'results' in data ? data.results : data
  const convertedResponse = convertV2ResponseData(purgedResponse, target, returnType)

  return _normalizeMetadata(/^__/, data, convertedResponse)
}

const _purgeODataV4 = data => {
  if (typeof data !== 'object') return data

  const purgedResponse = 'value' in data ? data.value : data
  return _normalizeMetadata(/^@odata\./, data, purgedResponse)
}

const TYPES_TO_REMOVE = { function: 1, object: 1 }
const PROPS_TO_IGNORE = { cause: 1, name: 1 }

const _getSanitizedError = (e, reqOptions, options = { suppressRemoteResponseBody: false, batchRequest: false }) => {
  const request = {
    method: reqOptions.method,
    url: e.config ? e.config.baseURL + e.config.url : reqOptions.url,
    headers: e.config ? e.config.headers : reqOptions.headers
  }
  if (options.batchRequest) request.body = reqOptions.data
  e.request = request

  if (e.response) {
    const response = { status: e.response.status, statusText: e.response.statusText, headers: e.response.headers }
    if (e.response.data && !options.suppressRemoteResponseBody) response.body = e.response.data
    e.response = response
  }

  const correlationId =
    (cds.context && cds.context.id) || (reqOptions.headers && reqOptions.headers['x-correlation-id'])
  if (correlationId) e.correlationId = correlationId

  // sanitize authorization
  _sanitizeHeaders(e.request.headers)

  // delete functions and complex objects in config
  for (const k in e) if (typeof e[k] === 'function') delete e[k]
  if (e.config) for (const k in e.config) if (TYPES_TO_REMOVE[typeof e.config[k]]) delete e.config[k]

  // REVISIT: ErrorWithCause log waaay to much -> copy what we want to new object (as delete e.cause doesn't work)
  if (e.cause) {
    let msg = ''
    let cur = e.cause
    while (cur) {
      msg += ' Caused by: ' + cur.message
      cur = cur.cause
    }
    const _e = { message: e.message + msg }
    for (const k of [...Object.keys(e).filter(k => !PROPS_TO_IGNORE[k])]) _e[k] = e[k]
    e = _e
  }

  // AxiosError's toJSON() method doesn't include the request and response objects
  if (e.__proto__.toJSON) {
    e.toJSON = function () {
      return { ...e.__proto__.toJSON(), request: this.request, response: this.response }
    }
  }

  return e
}

const run = async (requestConfig, options) => {
  let response

  const { destination, destinationOptions, jwt, suppressRemoteResponseBody } = options
  try {
    response = await _executeHttpRequest({
      requestConfig,
      destination,
      destinationOptions,
      jwt
    })
  } catch (e) {
    // > axios received status >= 400 -> gateway error
    const msg = e?.response?.data?.error?.message?.value ?? e?.response?.data?.error?.message ?? e.message
    e.message = msg ? 'Error during request to remote service: ' + msg : 'Request to remote service failed.'
    const sanitizedError = _getSanitizedError(e, requestConfig, { suppressRemoteResponseBody })
    const err = Object.assign(new Error(e.message), { statusCode: 502, reason: sanitizedError })
    LOG._warn && LOG.warn(err)
    throw err
  }

  // text/html indicates a redirect -> reject
  if (
    response.headers?.['content-type']?.includes('text/html') &&
    !(
      requestConfig.headers.accept.includes('text/html') ||
      requestConfig.headers.accept.includes('text/*') ||
      requestConfig.headers.accept.includes('*/*')
    )
  ) {
    const e = new Error("Received content-type 'text/html' which is not part of accepted content types")
    e.response = response
    const sanitizedError = _getSanitizedError(e, requestConfig, { suppressRemoteResponseBody })
    const message = 'Error during request to remote service: ' + e.message
    const err = Object.assign(new Error(message), { statusCode: 502, reason: sanitizedError })
    LOG._warn && LOG.warn(err)
    throw err
  }

  // get result of $batch
  // does only support read requests as of now
  if (requestConfig._autoBatchedGet) {
    // response data splitted by empty lines
    // 1. entry contains batch id and batch headers
    // 2. entry contains request status code and request headers
    // 3. entry contains data or error
    const responseDataSplitted = response.data.split('\r\n\r\n')

    // remove closing batch id
    const [content] = responseDataSplitted[2].split('\r\n')
    const contentJSON = JSON.parse(content)

    if (responseDataSplitted[1].startsWith('HTTP/1.1 2')) {
      response.data = contentJSON
    }

    if (responseDataSplitted[1].startsWith('HTTP/1.1 4') || responseDataSplitted[1].startsWith('HTTP/1.1 5')) {
      const innerError = contentJSON.error || contentJSON
      innerError.status = Number(responseDataSplitted[1].match(/HTTP.*(\d{3})/m)[1])
      innerError.response = response
      const sanitizedError = _getSanitizedError(innerError, requestConfig, { batchRequest: true })
      const err = Object.assign(new Error('Request to remote service failed.'), {
        statusCode: 502,
        reason: sanitizedError
      })

      LOG._warn && LOG.warn(err)
      throw err
    }
  }

  const { kind, resolvedTarget, returnType } = options
  if (kind === 'odata-v4') return _purgeODataV4(response.data)
  if (kind === 'odata-v2') return _purgeODataV2(response.data, resolvedTarget, returnType)
  if (kind === 'odata') {
    if (typeof response.data !== 'object') return response.data

    // try to guess if we need to purge v2 or v4
    if (response.data.d) return _purgeODataV2(response.data, resolvedTarget, returnType)
    return _purgeODataV4(response.data)
  }

  return response.data
}

const _cqnToReqOptions = (query, service, req) => {
  const { kind, model } = service
  const method = req.method
  const queryObject = cds.odata.urlify(query, { kind, model, method })
  const reqOptions = {
    method: queryObject.method,
    url: queryObject.path
      // ugly workaround for Okra not allowing spaces in ( x eq 1 )
      .replace(/\( /g, '(')
      .replace(/ \)/g, ')')
  }

  if (queryObject.method !== 'GET' && queryObject.method !== 'HEAD') {
    reqOptions.data = kind === 'odata-v2' ? convertV2PayloadData(queryObject.body, req.target) : queryObject.body
  }

  return reqOptions
}

const _stringToReqOptions = (query, data, target) => {
  const cleanQuery = query.trim()
  const blankIndex = cleanQuery.substring(0, 8).indexOf(' ')
  const reqOptions = {
    method: cleanQuery.substring(0, blankIndex).toUpperCase() || 'GET',
    url: encodeURI(formatPath(cleanQuery.substring(blankIndex, cleanQuery.length).trim()))
  }

  if (data && reqOptions.method !== 'GET' && reqOptions.method !== 'HEAD') {
    reqOptions.data = this.kind === 'odata-v2' ? Object.assign({}, convertV2PayloadData(data, target)) : data
  }

  return reqOptions
}

const _pathToReqOptions = (method, path, data, target, srvName) => {
  let url = path
  if (!url.startsWith('/')) {
    // extract entity name and instance identifier (either in "()" or after "/") from fully qualified path
    const parts = path.match(/([\w.]*)([\W.]*)(.*)/)
    if (!parts) url = '/' + path.match(/\w*$/)[0]
    else if (url.startsWith(srvName)) url = '/' + parts[1].replace(srvName + '.', '') + parts[2] + parts[3]
    else url = '/' + parts[1].match(/\w*$/)[0] + parts[2] + parts[3]

    // normalize in case parts[2] already starts with /
    url = url.replace(/^\/\//, '/')
  }

  const reqOptions = { method, url }
  if (data && reqOptions.method !== 'GET' && reqOptions.method !== 'HEAD') {
    reqOptions.data = this.kind === 'odata-v2' ? Object.assign({}, convertV2PayloadData(data, target)) : data
  }

  return reqOptions
}

const _hasHeader = (headers, header) =>
  Object.keys(headers || [])
    .map(k => k.toLowerCase())
    .includes(header)

const getReqOptions = (req, query, service) => {
  const reqOptions =
    typeof query === 'object'
      ? _cqnToReqOptions(query, service, req)
      : typeof query === 'string'
        ? _stringToReqOptions(query, req.data, req.target)
        : _pathToReqOptions(req.method, req.path, req.data, req.target, service.definition?.name || service.namespace) //> no model, no service.definition

  if (service.kind === 'odata-v2' && req.event === 'READ' && reqOptions.url?.match(/(\/any\()|(\/all\()/)) {
    req.reject(501, 'Lambda expressions are not supported in OData v2')
  }

  reqOptions.headers = { accept: 'application/json,text/plain' }

  if (!_hasHeader(req.headers, 'accept-language')) {
    // Forward the locale properties from the original request (including region variants or weight factors),
    // if not given, it's taken from the user's locale (normalized and simplified)
    const locale = req._locale
    if (locale) reqOptions.headers['accept-language'] = locale
  }

  // forward all dwc-* headers
  if (service.options.forward_dwc_headers) {
    const originalHeaders = req.context?.http.req.headers || {}
    for (const k in originalHeaders) if (k.match(/^dwc-/)) reqOptions.headers[k] = originalHeaders[k]
  }

  if (
    reqOptions.data &&
    reqOptions.method !== 'GET' &&
    reqOptions.method !== 'HEAD' &&
    !(reqOptions.data instanceof require('stream').Readable)
  ) {
    if (typeof reqOptions.data === 'object' && !Buffer.isBuffer(reqOptions.data)) {
      reqOptions.headers['content-type'] = 'application/json'
      reqOptions.headers['content-length'] = Buffer.byteLength(JSON.stringify(reqOptions.data))
    } else if (typeof reqOptions.data === 'string') {
      reqOptions.headers['content-length'] = Buffer.byteLength(reqOptions.data)
    } else if (Buffer.isBuffer(reqOptions.data)) {
      reqOptions.headers['content-length'] = Buffer.byteLength(reqOptions.data)
      if (!_hasHeader(req.headers, 'content-type')) reqOptions.headers['content-type'] = 'application/octet-stream'
    }
  }

  reqOptions.url = formatPath(reqOptions.url)

  // batch envelope if needed
  const maxGetUrlLength = service.options.max_get_url_length ?? cds.env.remote?.max_get_url_length ?? 1028
  if (KINDS_SUPPORTING_BATCH[service.kind] && reqOptions.method === 'GET' && reqOptions.url.length > maxGetUrlLength) {
    LOG._debug &&
      LOG.debug(
        `URL of remote request exceeds the configured max length of ${maxGetUrlLength}. Converting it to a $batch request.`
      )
    reqOptions._autoBatchedGet = true
    reqOptions.data = [
      '--batch1',
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      '',
      `${reqOptions.method} ${reqOptions.url.replace(/^\//, '')} HTTP/1.1`,
      ...Object.keys(reqOptions.headers).map(k => `${k}: ${reqOptions.headers[k]}`),
      '',
      '',
      '--batch1--',
      ''
    ].join('\r\n')
    reqOptions.method = 'POST'
    reqOptions.headers.accept = 'multipart/mixed'
    reqOptions.headers['content-type'] = 'multipart/mixed; boundary=batch1'
    reqOptions.url = '/$batch'
  }

  // mount resilience and csrf middlewares for SAP Cloud SDK
  reqOptions.middleware = [service.middlewares.timeout]
  const fetchCsrfToken = !!(reqOptions._autoBatchedGet ? service.csrfInBatch : service.csrf)
  if (fetchCsrfToken) reqOptions.middleware.push(service.middlewares.csrf)

  if (service.path) reqOptions.url = `${encodeURI(service.path)}${reqOptions.url}`

  // set axios responseType to 'arraybuffer' if returning binary in rest
  if (req._binary) reqOptions.responseType = 'arraybuffer'

  return reqOptions
}

module.exports = {
  run,
  getReqOptions
}
