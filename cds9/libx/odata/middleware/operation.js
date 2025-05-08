const cds = require('../../../')

const { pipeline } = require('node:stream/promises')

const { cds2edm, handleSapMessages } = require('../utils')
const getODataMetadata = require('../utils/metadata')
const postProcess = require('../utils/postProcess')
const getODataResult = require('../utils/result')

const location4 = require('../../http/location')

const { getKeysAndParamsFromPath } = require('../../common/utils/path')
const {
  collectStreamMetadata,
  getReadable,
  validateMimetypeIsAcceptedOrThrow
} = require('../../common/utils/streaming')

const _findEdmNameFor = (definition, namespace, fullyQualified = false) => {
  let name
  if (!definition) return ''
  if (definition._isStructured) {
    const structured = [definition.name]
    while (definition.parent) {
      definition = definition.parent
      structured.unshift(definition.name)
    }
    name = structured.join('_')
  } else {
    name = definition.name
  }
  if (!name.startsWith(`${namespace}.`)) return name
  return fullyQualified ? name : name.replace(new RegExp(`^${namespace}\\.`), '')
}

const _opResultName = ({ service, returnType, operation }) => {
  const { definition: { name: namespace } } = service // prettier-ignore
  if (returnType.name) {
    const resultName = _findEdmNameFor(returnType, namespace)
    if (returnType.name.startsWith(`${namespace}.`)) {
      return `${namespace}.${resultName.replace(/\./g, '_')}`
    }
    return resultName
  }
  // bound action / function returns inline structure
  if (operation.parent) {
    const boundEntityName = _findEdmNameFor(operation.parent, namespace, true).replace(/\./g, '_')
    // REVISIT exactly this return type name is generated in edm by compiler
    return `${namespace}.return_${boundEntityName}_${_findEdmNameFor(operation, namespace)}`
  }
  // unbound action / function returns inline structure
  // REVISIT exactly this return type name is generated in edm by compiler
  return `${namespace}.return_${_findEdmNameFor(operation, namespace, true).replace(/\./g, '_')}`
}

module.exports = adapter => {
  const { service } = adapter

  return function odata_operation(req, res, next) {
    let { operation, args } = req._query.SELECT?.from.ref?.slice(-1)[0] || {}
    if (!operation) return next() //> create or read

    const model = cds.context.model ?? service.model

    // unbound vs. bound
    let entity, params
    if (model.definitions[operation]) {
      operation = model.definitions[operation]
    } else {
      req._query.SELECT.from.ref.pop()
      let cur = { elements: model.definitions }
      for (const each of req._query.SELECT.from.ref) {
        cur = cur.elements[each.id || each]
        if (cur._target) cur = cur._target
      }
      operation = cur.actions[operation]
      entity = cur
      const keysAndParams = getKeysAndParamsFromPath(req._query.SELECT.from, { model })
      params = keysAndParams.params
    }

    // validate method
    if (
      (operation.kind === 'action' && req.method !== 'POST') ||
      (operation.kind === 'function' && req.method !== 'GET')
    ) {
      return next({ code: 405 })
    }

    // payload & params
    const data = args || req.body

    // event
    // REVISIT: when is operation.name actually prefixed with the service name?
    const event = operation.name.replace(`${service.definition.name}.`, '')

    const query = entity ? req._query : undefined

    // cdsReq.headers should contain merged headers of envelope and subreq
    const headers = { ...cds.context.http.req.headers, ...req.headers }

    // we need a cds.Request for multiple reasons, incl. params, headers, sap-messages, read after write, ...
    const target = query && cds.infer.target(query) // FIXME: this should not happen here but only in an event handler !
    const cdsReq = adapter.request4({ query, event, data, params, headers, target, req, res })

    const _isStream = operation.returns?._type === 'cds.LargeBinary' && !!operation.returns['@Core.MediaType']

    // NOTES:
    // - only via srv.run in combination with srv.dispatch inside,
    //   we automatically either use a single auto-managed tx for the req (i.e., insert and read after write in same tx)
    //   or the auto-managed tx opened for the respective atomicity group, if exists
    // - in the then block of .run(), the transaction is committed (i.e., before sending the response) if a single auto-managed tx is used
    return service
      .run(() =>
        service.dispatch(cdsReq).then(result => {
          if (res.headersSent) return result
          if (!_isStream) return result
          handleSapMessages(cdsReq, req, res)

          const stream = getReadable(result)
          if (!stream) {
            if (res.statusCode > 200) return res.end()
            return res.sendStatus(204)
          }

          const { mimetype, filename, disposition } = collectStreamMetadata(result, operation, query)
          validateMimetypeIsAcceptedOrThrow(req.headers, mimetype)
          if (!res.get('content-type')) res.set('content-type', mimetype)
          if (filename && !res.get('content-disposition'))
            res.set('content-disposition', `${disposition}; filename="${encodeURIComponent(filename)}"`)

          return pipeline(stream, res)
        })
      )
      .then(result => {
        if (res.headersSent) return

        handleSapMessages(cdsReq, req, res)

        if (operation.returns?.items && result == null) result = []
        if (!operation.returns || result == null) {
          if (res.statusCode > 200) return res.end()
          return res.sendStatus(204)
        }

        if (operation.returns._type?.match?.(/^cds\./)) {
          const context = `${'../'.repeat(query?.SELECT?.from?.ref?.length)}$metadata#${cds2edm[operation.returns._type]}`
          result = { '@odata.context': context, value: result }
          return res.send(result)
        }

        if (res.statusCode === 201 && !res.hasHeader('location')) {
          const location = location4(operation.returns, service, result)
          if (location) res.set('location', location)
        }

        if (operation.returns) {
          postProcess(operation.returns, model, result)
          if (result?.$etag) res.set('ETag', result.$etag) //> must be done after post processing
        }

        // REVISIT: enterprise search result? -> simply return what was provided
        if (operation.returns.type !== 'sap.esh.SearchResult') {
          const isCollection = !!operation.returns.items
          const _target = operation.returns.items ?? operation.returns
          const options = { result, isCollection }
          if (!_target.name) {
            // case: return inline type def
            options.edmName = _opResultName({ service, operation, returnType: _target })
          }
          const SELECT = {
            from: query ? { ref: [...query.SELECT.from.ref, { operation: operation.name }] } : {},
            one: !isCollection
          }
          const metadata = getODataMetadata({ SELECT, _target }, options)
          result = getODataResult(result, metadata, { isCollection })
        }

        res.send(result)
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
