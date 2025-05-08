const cds = require('../../../')

const { AsyncResource } = require('async_hooks')
const express = require('express')
const { STATUS_CODES } = require('http')
const qs = require('querystring')
const { URL } = require('url')

const multipartToJson = require('../parse/multipartToJson')
const { getBoundary } = require('../utils')

const { normalizeError } = require('./error')

const HTTP_METHODS = { GET: 1, POST: 1, PUT: 1, PATCH: 1, DELETE: 1 }
const CT = { JSON: 'application/json', MULTIPART: 'multipart/mixed' }
const CRLF = '\r\n'

/*
 * common
 */

const _deserializationError = message => cds.error(`Deserialization Error: ${message}`, { code: 400 })

// Function must be called with an object containing exactly one key-value pair representing the property name and its value
const _validateProperty = (name, value, type) => {
  if (value === undefined) throw _deserializationError(`Parameter '${name}' must not be undefined.`)

  switch (type) {
    case 'Array':
      if (!Array.isArray(value)) throw _deserializationError(`Parameter '${name}' must be type of '${type}'.`)
      break
    default:
      if (typeof value !== type) throw _deserializationError(`Parameter '${name}' must be type of '${type}'.`)
  }
}

const _validateBatch = body => {
  const { requests } = body

  _validateProperty('requests', requests, 'Array')

  if (requests.length > cds.env.odata.batch_limit)
    cds.error('BATCH_TOO_MANY_REQ', { code: 'BATCH_TOO_MANY_REQ', statusCode: 429 })

  const ids = {}

  let previousAtomicityGroup
  requests.forEach((request, i) => {
    if (typeof request !== 'object')
      throw _deserializationError(`Element of 'requests' array at index ${i} must be type of 'object'.`)

    const { id, method, url, body, atomicityGroup } = request

    _validateProperty('id', id, 'string')

    if (ids[id]) throw _deserializationError(`Request ID '${id}' is not unique.`)
    else ids[id] = request

    // TODO: validate allowed methods or let express throw the error?
    _validateProperty('method', method, 'string')
    if (!(method.toUpperCase() in HTTP_METHODS))
      throw _deserializationError(`Method '${method}' is not allowed. Only DELETE, GET, PATCH, POST or PUT are.`)

    _validateProperty('url', url, 'string')
    // TODO: need similar validation in multipart/mixed batch
    if (url.startsWith('/$batch')) throw _deserializationError('Nested batch requests are not allowed.')

    // TODO: support for non JSON bodies?
    if (body !== undefined && typeof body !== 'object')
      throw _deserializationError('A Content-Type header has to be specified for a non JSON body.')

    // TODO
    // if (!(method.toUpperCase() in { GET: 1, DELETE: 1 }) && !body)
    //   throw _deserializationError(`Body is required for ${method} requests.`)

    if (atomicityGroup) {
      _validateProperty('atomicityGroup', atomicityGroup, 'string')

      // All request objects with the same value for atomicityGroup MUST be adjacent in the requests array
      if (atomicityGroup !== previousAtomicityGroup) {
        if (ids[atomicityGroup]) throw _deserializationError(`Atomicity group ID '${atomicityGroup}' is not unique.`)
        else ids[atomicityGroup] = [request]
      } else {
        ids[atomicityGroup].push(request)
      }
    }

    if (url.startsWith('$')) {
      request.dependsOn ??= []
      const dependencyId = url.split('/')[0].replace(/^\$/, '')
      if (!request.dependsOn.includes(dependencyId)) {
        request.dependsOn.push(dependencyId)
      }
    }

    if (request.dependsOn) {
      _validateProperty('dependsOn', request.dependsOn, 'Array')
      request.dependsOn.forEach(dependsOnId => {
        _validateProperty('dependent request ID', dependsOnId, 'string')

        const dependency = ids[dependsOnId]
        if (!dependency) {
          throw _deserializationError(
            `"${dependsOnId}" does not match the id or atomicity group of any preceding request`
          )
        }

        // automatically add the atomicityGroup of the dependency as a dependency (actually a client error)
        const dag = dependency.atomicityGroup
        if (dag && dag !== atomicityGroup && !request.dependsOn.includes(dag)) {
          request.dependsOn.push(dag)
        }
      })
    }

    // TODO: validate if, and headers

    previousAtomicityGroup = atomicityGroup
  })

  return ids
}

// REVISIT: Why not simply use {__proto__:req, ...}?
const _createExpressReqResLookalike = (request, _req, _res) => {
  const { id, method, url } = request
  const ret = { id }

  const req = (ret.req = new express.request.constructor())
  req.__proto__ = express.request

  // express internals
  req.app = _req.app

  req.method = method.toUpperCase()
  req.url = url
  const u = new URL(url, 'http://cap')
  req.query = qs.parse(u.search.slice(1))
  req.headers = request.headers || {}
  if (request.content_id) req.headers['content-id'] = request.content_id
  req.body = request.body
  if (_req._login) req._login = _req._login

  const res = (ret.res = new express.response.constructor(req))
  res.__proto__ = express.response

  // REVISIT: mark as subrequest
  req._subrequest = true

  // express internals
  res.app = _res.app

  // back link
  req.res = res

  // resolve promise for subrequest via res.end()
  ret.promise = new Promise((resolve, reject) => {
    res.end = (chunk, encoding) => {
      res._chunk = chunk
      res._encoding = encoding
      if (res.statusCode >= 400) return reject(ret)
      resolve(ret)
    }
  })

  return ret
}

const _writeResponseMultipart = (responses, res, rejected, group, boundary) => {
  res.write(`--${boundary}${CRLF}`)

  if (rejected) {
    const resp = responses.find(r => r.status === 'fail')
    resp.txt.forEach(txt => {
      res.write(`${txt}${CRLF}`)
    })
  } else {
    if (group) res.write(`content-type: multipart/mixed;boundary=${group}${CRLF}${CRLF}`)
    for (const resp of responses) {
      resp.txt.forEach(txt => {
        if (group) res.write(`--${group}${CRLF}`)
        res.write(`${txt}${CRLF}`)
      })
    }
    if (group) res.write(`--${group}--${CRLF}`)
  }
}

const _writeResponseJson = (responses, res) => {
  for (const resp of responses) {
    if (resp.separator) res.write(resp.separator)
    resp.txt.forEach(txt => res.write(txt))
  }
}

let error_mws
const _getNextForLookalike = lookalike => {
  error_mws ??= cds.middlewares.after.filter(mw => mw.length === 4) // error middleware has 4 params
  return err => {
    let _err = err
    let _next_called
    const _next = e => {
      _err = e
      _next_called = true
    }
    for (const mw of error_mws) {
      _next_called = false
      mw(_err, lookalike.req, lookalike.res, _next)
      if (!_next_called) break //> next chain was interrupted -> done
    }
    if (_next_called) {
      // here, final error middleware called next (which actually shouldn't happen!)
      if (_err.statusCode) lookalike.res.status(_err.statusCode)
      if (typeof _err === 'object') lookalike.res.json({ error: _err })
      else lookalike.res.send(_err)
    }
  }
}

// REVISIT: This looks frightening -> need to review
const _transaction = async srv => {
  return new Promise(res => {
    const ret = {}
    const _tx = (ret._tx = srv.tx(
      async () =>
        (ret.promise = new Promise((resolve, reject) => {
          const proms = []
          // It's important to run `makePromise` in the current execution context (cb of srv.tx),
          // otherwise, it will use a different transaction.
          // REVISIT: This looks frightening -> need to review
          ret.add = AsyncResource.bind(function (makePromise) {
            const p = makePromise()
            proms.push(p)
            return p
          })
          ret.done = async function () {
            const result = await Promise.allSettled(proms)
            if (result.some(r => r.status === 'rejected')) {
              reject()
              // REVISIT: workaround to wait for commit/rollback
              await _tx
              return 'rejected'
            }
            resolve(result)
            // REVISIT: workaround to wait for commit/rollback
            await _tx
          }
          res(ret)
        }))
    ))
  })
}

const _tx_done = async (tx, responses, isJson) => {
  let rejected
  try {
    rejected = await tx.done()
  } catch (e) {
    // here, the commit was rejected even though all requests were successful (e.g., by custom handler or db consistency check)
    rejected = 'rejected'
    // construct commit error (without modifying original error)
    const error = normalizeError(Object.create(e), { locale: cds.context.locale })
    // replace all responses with commit error
    for (const res of responses) {
      res.status = 'fail'
      // REVISIT: should error go through any error middleware/ customization logic?
      if (isJson) {
        let txt = ''
        for (let i = 0; i < res.txt.length; i++) txt += Buffer.isBuffer(res.txt[i]) ? res.txt[i].toString() : res.txt[i]
        txt = JSON.parse(txt)
        txt.status = error.status
        txt.body = { error }
        // REVISIT: content-length needed? not there in multipart case...
        delete txt.headers['content-length']
        res.txt = [JSON.stringify(txt)]
      } else {
        const commitError = [
          'content-type: application/http',
          'content-transfer-encoding: binary',
          '',
          `HTTP/1.1 ${error.status} ${STATUS_CODES[error.status]}`,
          'odata-version: 4.0',
          'content-type: application/json;odata.metadata=minimal',
          '',
          JSON.stringify({ error })
        ].join(CRLF)
        res.txt = [commitError]
        break
      }
    }
  }
  return rejected
}

const _processBatch = async (srv, router, req, res, next, body, ct, boundary) => {
  body ??= req.body
  ct ??= 'JSON'
  // respond with requested content type (i.e., accept) with fallback to the content type used in the request
  let isJson = ct === 'JSON'
  if (req.headers.accept) {
    if (req.headers.accept.indexOf('multipart/mixed') > -1) isJson = false
    else if (req.headers.accept.indexOf('application/json') > -1) isJson = true
  }
  const _formatResponse = isJson ? _formatResponseJson : _formatResponseMultipart

  // continue-on-error defaults to true in json batch
  let continue_on_error = req.headers.prefer?.match(/odata\.continue-on-error(=(\w+))?/)
  if (!continue_on_error) {
    continue_on_error = isJson ? true : false
  } else {
    continue_on_error = continue_on_error[2] === 'false' ? false : true
  }

  try {
    const ids = _validateBatch(body) // REVISIT: we will not be able to validate the whole once we stream

    // TODO: if (!requests || !requests.length) throw new Error('At least one request, buddy!')

    let previousAtomicityGroup
    let separator
    let tx
    let responses

    // IMPORTANT: Avoid sending headers and responses too eagerly, as we might still have to send a 401
    let sendPreludeOnce = () => {
      res.setHeader('Content-Type', isJson ? CT.JSON : CT.MULTIPART + ';boundary=' + boundary)
      res.status(200)
      res.write(isJson ? '{"responses":[' : '')
      sendPreludeOnce = () => {} //> only once
    }

    const { requests } = body
    for await (const request of requests) {
      // for json payloads, normalize headers to lowercase
      if (ct === 'JSON') {
        request.headers = request.headers
          ? Object.keys(request.headers).reduce((acc, cur) => {
              acc[cur.toLowerCase()] = request.headers[cur]
              return acc
            }, {})
          : {}
      }

      request.headers['content-type'] ??= req.headers['content-type']

      const { atomicityGroup } = request

      if (!atomicityGroup || atomicityGroup !== previousAtomicityGroup) {
        if (tx) {
          // Each change in `atomicityGroup` results in a new transaction. We execute them in sequence to avoid too many database connections.
          // In the future, we might make this configurable (e.g. allow X parallel connections per HTTP request).
          const rejected = await _tx_done(tx, responses, isJson)
          if (tx.failed?.res.statusCode === 401 && req._login) return req._login()
          else sendPreludeOnce()
          isJson
            ? _writeResponseJson(responses, res)
            : _writeResponseMultipart(responses, res, rejected, previousAtomicityGroup, boundary)
          if (rejected && !continue_on_error) {
            tx = null
            break
          }
        }

        responses = []
        tx = await _transaction(srv)
        if (atomicityGroup) ids[atomicityGroup].promise = tx._tx
      }

      tx.add(() => {
        return (request.promise = (async () => {
          const dependencies = request.dependsOn?.filter(id => id !== request.atomicityGroup).map(id => ids[id].promise)
          if (dependencies) {
            // first, wait for dependencies
            const results = await Promise.allSettled(dependencies)
            const dependendOnFailed = results.some(({ status }) => status === 'rejected')
            if (dependendOnFailed) {
              tx.id = request.id
              tx.res = {
                getHeaders: () => {},
                statusCode: 424,
                _chunk: JSON.stringify({
                  code: '424',
                  message: 'Failed Dependency'
                })
              }
              throw tx
            }

            const dependsOnId = request.url.split('/')[0].replace(/^\$/, '')
            if (dependsOnId in ids) {
              const dependentResult = results.find(r => r.value.id === dependsOnId)
              const dependentOnUrl = dependentResult.value.req.originalUrl
              const dependentOnResult = JSON.parse(dependentResult.value.res._chunk)
              const recentUrl = request.url
              const cqn = cds.odata.parse(dependentOnUrl, { service: srv, baseUrl: req.baseUrl, strict: true })
              const target = cds.infer.target(cqn)
              const keyString =
                '(' +
                [...target.keys]
                  .filter(k => !k.isAssociation)
                  .map(k => {
                    let v = dependentOnResult[k.name]
                    if (typeof v === 'string' && k._type !== 'cds.UUID') v = `'${v}'`
                    return k.name + '=' + v
                  })
                  .join(',') +
                ')'
              request.url = recentUrl.replace(`$${dependsOnId}`, dependentOnUrl + keyString)
            }
          }

          // REVIST: That sends each request through the whole middleware chain again and again, including authentication and authorization.
          // -> We should optimize this!
          const lookalike = _createExpressReqResLookalike(request, req, res)
          const lookalike_next = _getNextForLookalike(lookalike)
          router.handle(lookalike.req, lookalike.res, lookalike_next)
          return lookalike.promise
        })())
      })
        .then(req => {
          const resp = { status: 'ok' }
          if (separator) resp.separator = separator
          else separator = Buffer.from(',')
          resp.txt = _formatResponse(req, atomicityGroup)
          responses.push(resp)
        })
        .catch(failedReq => {
          const resp = { status: 'fail' }
          if (separator) resp.separator = separator
          else separator = Buffer.from(',')
          resp.txt = _formatResponse(failedReq, atomicityGroup)
          tx.failed = failedReq
          responses.push(resp)
        })

      previousAtomicityGroup = atomicityGroup
    }

    if (tx) {
      // The last open transaction must be finished
      const rejected = await _tx_done(tx, responses, isJson)
      if (tx.failed?.res.statusCode === 401 && req._login) return req._login()
      else sendPreludeOnce()
      isJson
        ? _writeResponseJson(responses, res)
        : _writeResponseMultipart(responses, res, rejected, previousAtomicityGroup, boundary)
    } else sendPreludeOnce()
    res.write(isJson ? ']}' : `--${boundary}--${CRLF}`)
    res.end()

    return
  } catch (e) {
    next(e)
  }
}

/*
 * multipart/mixed
 */

const _multipartBatch = async (srv, router, req, res, next) => {
  const boundary = getBoundary(req)
  if (!boundary) return next(new cds.error('No boundary found in Content-Type header', { code: 400 }))

  try {
    const { requests } = await multipartToJson(req.body, boundary)
    _processBatch(srv, router, req, res, next, { requests }, 'MULTIPART', boundary)
  } catch (e) {
    // REVISIT: (how) handle multipart accepts?
    next(e)
  }
}

const _formatResponseMultipart = request => {
  const { res: response } = request
  const content_id = request.req?.headers['content-id']

  let txt = `content-type: application/http${CRLF}content-transfer-encoding: binary${CRLF}`
  if (content_id) txt += `content-id: ${content_id}${CRLF}`
  txt += CRLF
  txt += `HTTP/1.1 ${response.statusCode} ${STATUS_CODES[response.statusCode]}${CRLF}`

  // REVISIT: tests require specific sequence
  const headers = {
    ...response.getHeaders(),
    ...(response.statusCode !== 204 && { 'content-type': 'application/json;odata.metadata=minimal' })
  }
  delete headers['content-length'] //> REVISIT: expected by tests

  for (const key in headers) {
    txt += key + ': ' + headers[key] + CRLF
  }
  txt += CRLF

  const _tryParse = x => {
    try {
      return JSON.parse(x)
    } catch {
      return x
    }
  }

  if (response._chunk) {
    const chunk = _tryParse(response._chunk)
    if (chunk && typeof chunk === 'object') {
      let meta = [],
        data = []
      for (const [k, v] of Object.entries(chunk)) {
        if (k.startsWith('@')) meta.push(`"${k}":${typeof v === 'string' ? `"${v.replaceAll('"', '\\"')}"` : v}`)
        else data.push(JSON.stringify({ [k]: v }).slice(1, -1))
      }
      const _json_as_txt = '{' + meta.join(',') + (meta.length && data.length ? ',' : '') + data.join(',') + '}'
      txt += _json_as_txt
    } else {
      txt += chunk
      txt = txt.replace('content-type: application/json;odata.metadata=minimal', 'content-type: text/plain')
    }
  }

  return [txt]
}

/*
 * application/json
 */

const _formatStatics = {
  comma: ','.charCodeAt(0),
  body: Buffer.from('"body":'),
  close: Buffer.from('}')
}

const _formatResponseJson = (request, atomicityGroup) => {
  const { id, res: response } = request

  const chunk = {
    id,
    status: response.statusCode,
    headers: {
      ...response.getHeaders(),
      'content-type': 'application/json' //> REVISIT: why?
    }
  }
  if (atomicityGroup) chunk.atomicityGroup = atomicityGroup
  const raw = Buffer.from(JSON.stringify(chunk))

  // body?
  if (!response._chunk) return [raw]

  // change last "}" into ","
  raw[raw.byteLength - 1] = _formatStatics.comma
  return [raw, _formatStatics.body, response._chunk, _formatStatics.close]
}

/*
 * exports
 */

module.exports = adapter => {
  const { router, service } = adapter
  const textBodyParser = express.text({
    ...adapter.body_parser_options,
    type: '*/*' // REVISIT: why do we need to override type here?
  })

  return function odata_batch(req, res, next) {
    if (req.method !== 'POST') {
      throw cds.error(`Method ${req.method} is not allowed for calls to $batch endpoint`, { code: 405 })
    }

    if (req.headers['content-type'].includes('application/json')) {
      return _processBatch(service, router, req, res, next)
    }

    if (req.headers['content-type'].includes('multipart/mixed')) {
      return textBodyParser(req, res, function odata_batch_next(err) {
        if (err) return next(err)
        return _multipartBatch(service, router, req, res, next)
      })
    }

    throw cds.error('Batch requests must have content type multipart/mixed or application/json', { statusCode: 400 })
  }
}
