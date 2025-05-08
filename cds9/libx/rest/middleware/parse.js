module.exports = exports = adapter => exports.parse.bind(adapter)

/**
 * @type {import('express').Handler}
 * @this import('../RestAdapter')
 */
exports.parse = function (req, res, next) {
  const { service } = this

  // REVISIT: Once we don't display the error message location in terms of an offset, but instead a copy of the
  // original request including a marker, we don't need to provide the baseUrl here.
  let query = cds.odata.parse(req.url, { service, baseUrl: req.baseUrl, protocol: 'rest' })

  // parser always produces selects
  const _target = (req._target = query.SELECT && query.SELECT.from)
  if (!_target) return next()

  // REVISIT: __target is the csn target definition
  let {
    __target: definition,
    SELECT: { from, one }
  } = query
  if (typeof definition === 'string') {
    definition =
      service.model.definitions[definition] ||
      service.model.definitions[definition.split(':$:')[0]].actions[definition.split(':$:')[1]]
  }
  delete query.__target

  // req.__proto__.method is set in case of upsert
  const isUpsert = req.__proto__.method in { PUT: 1, PATCH: 1 }

  // REVISIT: hack for actions and functions
  let operation, args
  const last = _target.ref[_target.ref.length - 1]
  if (last.operation) {
    operation = last.operation
    if (last.args) args = last.args
    _target.ref.pop()
  }

  const unbound = _target.ref.length === 0

  // query based on method
  switch (req.method) {
    case 'HEAD':
    case 'GET':
      if (operation) {
        req._operation = operation = definition
        if (operation.kind === 'action') cds.error('Action must be called by POST', { code: 400 })
        if (!unbound) query = one ? SELECT.one(_target) : SELECT.from(_target)
        else query = undefined
      } else {
        // read (nothing to do)
      }
      break
    case 'POST':
      if (operation) {
        req._operation = operation = definition
        if (operation.kind === 'function') cds.error('Function must be called by GET', { code: 400 })
        if (!unbound) query = one ? SELECT.one(_target) : SELECT.from(_target)
        else query = undefined
      } else {
        // create
        if (one && !isUpsert) cds.error('POST not allowed on entity', { code: 400 })
        query = INSERT.into(_target)
      }
      break
    case 'PUT':
    case 'PATCH':
      if (operation) {
        let errorMsg
        if (definition) {
          errorMsg = `${definition.kind.charAt(0).toUpperCase() + definition.kind.slice(1)} must be called by ${
            definition.kind === 'action' ? 'POST' : 'GET'
          }`
        } else {
          errorMsg = `That action/function must be called by POST/GET`
        }
        cds.error(errorMsg, { code: 400 })
      }
      if (!one) throw { statusCode: 400, code: '400', message: `INVALID_${req.method}` }
      query = UPDATE(_target)
      break
    case 'DELETE':
      if (operation) {
        let errorMsg
        if (definition) {
          errorMsg = `${definition.kind.charAt(0).toUpperCase() + definition.kind.slice(1)} must be called by ${
            definition.kind === 'action' ? 'POST' : 'GET'
          }`
        } else {
          errorMsg = `That action/function must be called by POST/GET`
        }
        cds.error(errorMsg, { code: 400 })
      }
      if (!one) cds.error('DELETE not allowed on collection', { code: 400 })
      query = DELETE.from(_target)
      break
    default:
    // anything to do?
  }
  req._query = query // REVISIT: req._query should not be a standard API

  if (!definition) return next()

  const { keys, params } = getKeysAndParamsFromPath(from, service)
  req._data = operation?.kind === 'function' ? {} : keys
  if (params) req._params = params

  // REVISIT: query._data hack
  if ((query && (query.INSERT || query.UPDATE || query.DELETE)) || (operation && operation.kind === 'action') || args) {
    if (operation && (operation.kind === 'action' || operation.kind === 'function') && !operation.params) {
      req._data = {}
    } else {
      const payload = args || req.body
      if (!operation) Object.assign(payload, keys)
      if (!cds.env.features.cds_validate) {
        const errs = []
        convertStructured(service, operation || definition, payload, {
          cleanupStruct: cds.env.features.rest_struct_data
        })
        preProcessData(payload, service, definition, _cache, errs)
        if (errs.length) {
          if (errs.length === 1) throw errs[0]
          throw Object.assign(new Error('MULTIPLE_ERRORS'), { statusCode: 400, details: errs })
        }
      } else {
        preProcessData(payload, service, definition)
      }
      req._data = payload
    }
  }

  next()
}

const cds = require('../../_runtime/cds')
const { INSERT, SELECT, UPDATE, DELETE } = cds.ql

const { getKeysAndParamsFromPath } = require('../../common/utils/path')

const { preProcessData } = require('../pre-processing')
const { convertStructured } = require('../../_runtime/common/utils/ucsn')

const _cache = req => `rest-input;skip-key-validation:${req.method !== 'POST'}`
