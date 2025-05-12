const cds = require('../cds')

const { run, getReqOptions } = require('./utils/client')
const { getCloudSdk, getCloudSdkConnectivity, getCloudSdkResilience } = require('./utils/cloudSdkProvider')
const { hasAliasedColumns } = require('./utils/data')
const postProcess = require('../common/utils/postProcess')
const { formatVal } = require('../../odata/utils')

const _getHeaders = (defaultHeaders, req) => {
  return Object.assign(
    {},
    defaultHeaders,
    Object.keys(req.headers).reduce((acc, cur) => {
      acc[cur.toLowerCase()] = req.headers[cur]
      return acc
    }, {})
  )
}

const _setCorrectValue = (el, data, params, kind) => {
  if (data[el] === undefined) return "'undefined'"
  return typeof data[el] === 'object' && kind !== 'odata-v2'
    ? JSON.stringify(data[el])
    : formatVal(data[el], el, { elements: params }, kind)
}

// v4: builds url like /function(p1=@p1,p2=@p2,p3=@p3)?@p1=val&@p2={...}&@p3=[...]
// v2: builds url like /function?p1=val1&p2=val2 for functions and actions
const _buildPartialUrlFunctions = (url, data, params, kind = 'odata-v4') => {
  const funcParams = []
  const queryOptions = []

  // REVISIT: take params from params after importer fix (the keys should not be part of params)
  for (const param in _extractParamsFromData(data, params)) {
    if (data[param] === undefined) continue

    if (kind === 'odata-v2') {
      funcParams.push(`${param}=${_setCorrectValue(param, data, params, kind)}`)
    } else {
      funcParams.push(`${param}=@${param}`)
      queryOptions.push(`@${param}=${_setCorrectValue(param, data, params, kind)}`)
    }
  }

  return kind === 'odata-v2'
    ? `${url}?${funcParams.join('&')}`
    : `${url}(${funcParams.join(',')})?${queryOptions.join('&')}`
}

const _extractParamsFromData = (data, params = {}) => {
  return Object.keys(data).reduce((res, el) => {
    if (params[el]) Object.assign(res, { [el]: data[el] })
    return res
  }, {})
}

const _buildKeys = (req, kind) => {
  const keys = []

  if (req.params && req.params.length > 0) {
    const p1 = req.params[0]
    if (typeof p1 !== 'object') return [p1]

    for (const key in req.target.keys) {
      keys.push(`${key}=${formatVal(p1[key], key, req.target, kind)}`)
    }
  } else {
    // REVISIT: shall we keep that or remove it?
    for (const key in req.target.keys) {
      keys.push(`${key}=${formatVal(req.data[key], key, req.target, kind)}`)
    }
  }

  return keys
}

const _handleBoundActionFunction = (srv, def, req, url) => {
  if (def.kind === 'action') {
    return srv.post(url, def.params ? _extractParamsFromData(req.data, def.params) : {})
  }

  if (def.params) {
    const data = _extractParamsFromData(req.data, def.params)
    url = _buildPartialUrlFunctions(url, data, def.params)
  } else {
    url = `${url}()`
  }

  return srv.get(url)
}

const _handleUnboundActionFunction = (srv, def, req, event) => {
  if (def.kind === 'action') {
    // REVISIT: only for "rest" unbound actions/functions, we enforce axios to return a buffer
    // required by cds-mt
    const isBinary = srv.kind === 'rest' && def?.returns?.type?.match(/binary/i)
    const { headers, data } = req

    return srv.send({ method: 'POST', path: `/${event}`, headers, data, _binary: isBinary })
  }

  const url =
    Object.keys(req.data).length > 0 ? _buildPartialUrlFunctions(`/${event}`, req.data, def.params) : `/${event}()`
  return srv.get(url)
}

const _sendV2RequestActionFunction = (srv, def, req, url) => {
  const { headers } = req
  return def.kind === 'function'
    ? srv.send({ method: 'GET', path: url, headers, _returnType: def.returns })
    : srv.send({ method: 'POST', path: url, headers, data: {}, _returnType: def.returns })
}

const _handleV2ActionFunction = (srv, def, req, event, kind) => {
  const url =
    Object.keys(req.data).length > 0 ? _buildPartialUrlFunctions(`/${event}`, req.data, def.params, kind) : `/${event}`
  return _sendV2RequestActionFunction(srv, def, req, url)
}

const _handleV2BoundActionFunction = (srv, def, req, event, kind) => {
  const params = []
  const data = req.data

  // REVISIT: take params from def.params, after importer fix (the keys should not be part of params)
  for (const param in _extractParamsFromData(req.data, def.params)) {
    params.push(`${param}=${formatVal(data[param], param, { elements: def.params }, kind)}`)
  }

  const keys = _buildKeys(req, this.kind)
  if (keys.length === 1 && typeof req.params[0] !== 'object') {
    params.push(`${Object.keys(req.target.keys)[0]}=${keys[0]}`)
  } else {
    params.push(...keys)
  }

  const url = `${`/${event}`}?${params.join('&')}`
  return _sendV2RequestActionFunction(srv, def, req, url)
}

const _addHandlerActionFunction = (srv, def, target) => {
  const event = def.name.match(/\w*$/)[0]

  if (target) {
    srv.on(event, target, async function (req) {
      const shortEntityName = req.target.name.replace(`${this.definition.name}.`, '')
      if (this.kind === 'odata-v2') return _handleV2BoundActionFunction(srv, def, req, event, this.kind)
      const url = `/${shortEntityName}(${_buildKeys(req, this.kind).join(',')})/${this.definition.name}.${event}`
      return _handleBoundActionFunction(srv, def, req, url)
    })
  } else {
    srv.on(event, async function (req) {
      if (this.kind === 'odata-v2') return _handleV2ActionFunction(srv, def, req, event, this.kind)
      return _handleUnboundActionFunction(srv, def, req, event)
    })
  }
}

const _isSelectWithAliasedColumns = q => q?.SELECT && !q._transitions && q.SELECT.columns?.some(hasAliasedColumns)

const resolvedTargetOfQuery = q => q?._transitions?.at(-1)?.target

const _resolveSelectionStrategy = options => {
  if (typeof options?.selectionStrategy !== 'string') return

  options.selectionStrategy = getCloudSdkConnectivity().DestinationSelectionStrategies[options.selectionStrategy]
  if (typeof options?.selectionStrategy !== 'function') {
    throw new Error(`Unsupported destination selection strategy "${options.selectionStrategy}".`)
  }
}

const _getKind = options => {
  const kind = (options.credentials && options.credentials.kind) || options.kind
  if (typeof kind === 'object') {
    const k = Object.keys(kind).find(
      key => key === 'odata' || key === 'odata-v4' || key === 'odata-v2' || key === 'rest'
    )
    // odata-v4 is equivalent of odata
    return k === 'odata-v4' ? 'odata' : k
  }
  return kind
}

const _getDestination = (name, credentials) => {
  // Cloud SDK wants property "queryParameters" but we have documented "queries"
  if (credentials.queries && !credentials.queryParameters) credentials.queryParameters = credentials.queries
  return { name, ...credentials }
}

class RemoteService extends cds.Service {
  init() {
    this.kind = _getKind(this.options) // TODO: Simplify

    /*
     * set up connectivity stuff if credentials are provided
     * throw error if no credentials are provided and the service has at least one entity or one action/function
     */
    if (this.options.credentials) {
      this.datasource = this.options.datasource
      this.destinationOptions = this.options.destinationOptions
      _resolveSelectionStrategy(this.destinationOptions)
      this.destination =
        this.options.credentials.destination ??
        _getDestination(this.definition?.name ?? this.datasource, this.options.credentials)
      this.path = this.options.credentials.path

      // `requestTimeout` API is kept as it was public
      this.requestTimeout = this.options.credentials.requestTimeout ?? 60000

      this.csrf = this.options.csrf
      this.csrfInBatch = this.options.csrfInBatch

      // we're using this as an object to allow remote services without the need for Cloud SDK
      // required for BAS creating remote services only for events
      // at first request the middlewares are created
      this.middlewares = {
        timeout: getCloudSdkResilience().timeout(this.requestTimeout),
        csrf: this.csrf && getCloudSdk().csrf(this.csrf)
      }
    } else if ([...this.entities].length || [...this.operations].length) {
      throw new Error(`No credentials configured for "${this.name}".`)
    }

    const clearKeysFromData = function (req) {
      if (req.target && req.target.keys) for (const k of Object.keys(req.target.keys)) delete req.data[k]
    }
    this.before('UPDATE', '*', Object.assign(clearKeysFromData, { _initial: true }))

    for (const each of this.entities) {
      for (const a in each.actions) {
        _addHandlerActionFunction(this, each.actions[a], each)
      }
    }

    for (const each of this.operations) _addHandlerActionFunction(this, each)

    // IMPORTANT: regular function is used on purpose, don't switch to arrow function.
    this.on('*', async function on_handler(req, next) {
      const { query } = req
      if (!query && !(typeof req.path === 'string')) return next()

      // early validation on first request for use case without remote API
      // ideally, that's done on bootstrap of the remote service
      if (typeof this.destination === 'object' && !this.destination.url)
        throw new Error(`"url" or "destination" property must be configured in "credentials" of "${this.name}".`)

      const reqOptions = getReqOptions(req, query, this)
      reqOptions.headers = _getHeaders(reqOptions.headers, req)

      // REVISIT: we should not have to set the content-type at all for that
      if (reqOptions.headers.accept?.match(/stream|image|tar/)) reqOptions.responseType = 'stream'

      // ensure request correlation (even with systems that use x-correlationid)
      const correlationId = reqOptions.headers['x-correlation-id'] || cds.context?.id //> prefer custom header over context id
      reqOptions.headers['x-correlation-id'] = correlationId
      reqOptions.headers['x-correlationid'] = correlationId

      const { kind, destination, destinationOptions } = this
      const resolvedTarget =
        resolvedTargetOfQuery(query) || cds.ql.resolve.transitions(query, this)?.target || req.target
      const returnType = req._returnType
      const additionalOptions = { destination, kind, resolvedTarget, returnType, destinationOptions }

      // REVISIT: i don't believe req.context.headers is an official API
      let jwt = req?.context?.headers?.authorization?.split(/^bearer /i)[1]
      if (!jwt) jwt = req?.context?.http?.req?.headers?.authorization?.split(/^bearer /i)[1]
      if (jwt) additionalOptions.jwt = jwt

      // hidden compat flag in order to suppress logging response body of failed request
      if (req._suppressRemoteResponseBody) {
        additionalOptions.suppressRemoteResponseBody = req._suppressRemoteResponseBody
      }

      let result = await run(reqOptions, additionalOptions)
      result = typeof query === 'object' && query.SELECT?.one && Array.isArray(result) ? result[0] : result
      return result
    })

    return super.init()
  }

  // Overload .handle in order to resolve projections up to a definition that is known by the remote service instance.
  // Result is post processed according to the inverse projection in order to reflect the correct result of the original query.
  async handle(req) {
    if (!this._requires_resolving(req))
      return super.handle(req).then(
        // we need to post process if alias was explicitly set in query
        result => (_isSelectWithAliasedColumns(req.query) ? postProcess(req.query, result, this, true) : result)
      )
    // rewrite the query to a target entity served by this service...
    const query = this.resolve(req.query)
    if (!query) throw new Error(`Target ${req.target.name} cannot be resolved for service ${this.name}`)
    const target = query._target || req.target
    // we need to provide target explicitly because it's cached within ensure_target
    const _req = new cds.Request({ query, target, _resolved: true, headers: req.headers, method: req.method })
    return await super.dispatch(_req).then(result => postProcess(query, result, this, true))
  }
}

RemoteService.prototype.isExternal = true
module.exports = RemoteService
