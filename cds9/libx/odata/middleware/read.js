const cds = require('../../../')

const querystring = require('node:querystring')

const { handleSapMessages, validateIfNoneMatch, getPreferReturnHeader } = require('../utils')
const getODataMetadata = require('../utils/metadata')
const postProcess = require('../utils/postProcess')
const getODataResult = require('../utils/result')

const { getKeysAndParamsFromPath } = require('../../common/utils/path')

const { getPageSize } = require('../../_runtime/common/generic/paging')
const { handleStreamProperties } = require('../../_runtime/common/utils/streamProp')

const _getCount = result => (Array.isArray(result) && result.length ? result[0].$count || 0 : result.$count || 0)

const _setNextLink = (req, result) => {
  const $skiptoken = result.$nextLink ?? _calculateSkiptoken(req, result)
  if (!$skiptoken) return

  const queryParamsWithSkipToken = { ...req.req.query, $skiptoken }
  const encodedQueryParams = querystring.stringify(queryParamsWithSkipToken)

  // percent-encode all path segments with key values inside parentheses, but keep Navigation Properties untouched
  const encodedPath = req.req.path.slice(1).replace(/\('([^']*)'\)/g, (match, key) => `('${encodeURIComponent(key)}')`)

  result.$nextLink = `${encodedPath}?${encodedQueryParams}`
}

const _calculateSkiptoken = (req, result) => {
  const limit = Array.isArray(req.query) ? getPageSize(req.query[0]._target).max : req.query.SELECT.limit?.rows?.val
  const top = parseInt(req.req.query.$top)
  if (limit === result.length && limit !== top) {
    const token = req.req.query.$skiptoken
    if (cds.env.query.limit.reliablePaging && _reliablePagingPossible(req)) {
      const decoded = token && JSON.parse(Buffer.from(token, 'base64').toString())
      const skipToken = {
        r: (decoded?.r || 0) + limit,
        c: req.query.SELECT.orderBy.map(o => ({
          a: o.sort ? o.sort === 'asc' : true,
          k: o.ref[0],
          v: result[result.length - 1][o.ref[0]]
        }))
      }

      if (limit + (decoded?.r || 0) !== top) {
        return Buffer.from(JSON.stringify(skipToken)).toString('base64')
      }
    } else {
      return (token ? parseInt(token) : 0) + limit
    }
  }
}

const _reliablePagingPossible = req => {
  if (req.target._isDraftEnabled) return false
  if (cds.context?.http.req.query.$apply) return false
  if (req.query.SELECT.limit.offset?.val ?? req.query.SELECT.limit.offset > 0) return false
  if (req.query.SELECT.orderBy?.some(o => !o.ref)) return false
  return (
    !req.query.SELECT.columns ||
    req.query.SELECT.columns.some(c => c === '*' || c.ref?.[0] === '*') ||
    req.query.SELECT.orderBy?.every(o => req.query.SELECT.columns?.some(c => o.ref[0] === c.ref?.[0]))
  )
}

const _checkExpandDeep = (column, entity, namespace) => {
  const { expand } = column
  if (expand.length > 1 || expand[0] !== '*') {
    for (const expandColumn of expand) {
      if (expandColumn === '*') continue
      if (expandColumn.expand) {
        _checkExpandDeep(expandColumn, entity.elements[expandColumn.ref[0]]._target, namespace)
      }
    }
  }
  if (!entity.name.startsWith(namespace) && !entity._service) {
    // proxy, only add keys
    const asteriskIndex = column.expand.findIndex(e => e === '*')
    column.expand.splice(asteriskIndex)
    for (const key in entity.keys) {
      if (entity.elements[key].isAssociation) continue
      column.expand.push({ ref: [key] })
    }
  }
}

const resolveProxyExpands = (query, service) => {
  const { SELECT } = query
  if (!SELECT.columns) return
  const { elements } = cds.infer.target(query) // FIXME: this should not happen here but only in an event handler !
  for (const column of SELECT.columns) {
    if (column.expand) {
      _checkExpandDeep(column, elements[column.ref[0]]._target, service.definition.name)
    }
  }
}

const _isNullableSingleton = query => query._target._isSingleton && query._target['@odata.singleton.nullable']

const _isToOneAssoc = query =>
  query.SELECT.from.ref.length > 1 && typeof query.SELECT.from.ref.slice(-1)[0] === 'string'

const _count = result => {
  if (Array.isArray(result))
    return result.reduce((acc, val) => {
      return acc + (val?.$count ?? val?._counted_ ?? (Array.isArray(val) && _count(val))) || 0
    }, 0)
  else return result.$count ?? result._counted_ ?? 0
}

// REVISIT: integrate with default handler
const _handleArrayOfQueriesFactory = adapter => {
  const { service } = adapter

  return (req, res, next) => {
    const cdsReq = adapter.request4({ query: req._query, req, res })

    // NOTES:
    // - only via srv.run in combination with srv.dispatch inside,
    //   we automatically either use a single auto-managed tx for the req (i.e., insert and read after write in same tx)
    //   or the auto-managed tx opened for the respective atomicity group, if exists
    // - in the then block of .run(), the transaction is committed (i.e., before sending the response) if a single auto-managed tx is used
    return service
      .run(() => {
        return service.dispatch(cdsReq).then(result => {
          // nothing to do
          return result
        })
      })
      .then(result => {
        if (res.headersSent) return

        handleSapMessages(cdsReq, req, res)

        if (req.url.match(/\/\$count/)) return res.set('Content-Type', 'text/plain').send(_count(result).toString())

        const { context: mainOdataContext } = getODataMetadata(req._query[0], {
          result: result[0],
          isCollection: !req._query[0].SELECT.one
        })
        // Skip first query, as its context is represented in the main context
        for (let i = 1; i < result.length; i++) {
          const { context: subOdataContext } = getODataMetadata(req._query[i], {
            result: result[i],
            isCollection: !req._query[i].SELECT.one
          })
          // Add OData context, if it deviates from main context
          if (mainOdataContext !== subOdataContext) {
            // OData spec: "If present, the context control information MUST be the first property in the JSON object."
            result[i] = result[i].map(entry => ({ '@odata.context': subOdataContext, ...entry }))
          }
        }

        result = result.flat(Infinity)
        if (cdsReq.query[0].SELECT.count) result.$count = result.length

        result = getODataResult(
          result,
          { context: mainOdataContext },
          { isCollection: !req._query[0].SELECT.one, property: req._query[0]._propertyAccess }
        )
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

module.exports = adapter => {
  const { service } = adapter

  const _handleArrayOfQueries = _handleArrayOfQueriesFactory(adapter)

  return function read(req, res, next) {
    if (getPreferReturnHeader(req)) {
      const msg = `The 'return' preference is not allowed in ${req.method} requests`
      throw Object.assign(new Error(msg), { statusCode: 400 })
    }

    // $apply with concat -> multiple queries with special handling
    if (Array.isArray(req._query)) return _handleArrayOfQueries(req, res, next)

    const model = cds.context.model ?? service.model

    // REVISIT: better solution for _propertyAccess
    let {
      SELECT: { from, one },
      _propertyAccess
    } = req._query
    const { _query: query } = req

    // payload & params
    const { keys, params } = getKeysAndParamsFromPath(from, { model })
    const data = keys //> for read and delete, we provide keys in req.data

    // cdsReq.headers should contain merged headers of envelope and subreq
    const headers = { ...cds.context.http.req.headers, ...req.headers }

    // we need a cds.Request for multiple reasons, incl. params, headers, sap-messages, read after write, ...
    const cdsReq = adapter.request4({ query, data, params, headers, req, res })

    if (cds.env.effective.odata.proxies && cds.env.effective.odata.xrefs) {
      // REVISIT check above is still not perfect solution
      resolveProxyExpands(query, service)
    }

    if (!query.SELECT.columns) query.SELECT.columns = ['*']

    const target = cds.infer.target(req._query) // FIXME: this should not happen here but only in an event handler !
    handleStreamProperties(target, query.SELECT.columns, model)

    // NOTES:
    // - only via srv.run in combination with srv.dispatch inside,
    //   we automatically either use a single auto-managed tx for the req (i.e., insert and read after write in same tx)
    //   or the auto-managed tx opened for the respective atomicity group, if exists
    // - in the then block of .run(), the transaction is committed (i.e., before sending the response) if a single auto-managed tx is used
    return service
      .run(() => {
        return service.dispatch(cdsReq).then(result => {
          // 404
          if (result == null && query.SELECT.one && !(_isNullableSingleton(query) || _isToOneAssoc(query)))
            throw new cds.error(404)

          return result
        })
      })
      .then(result => {
        if (res.headersSent) return

        handleSapMessages(cdsReq, req, res)

        // 204
        if (result == null && query.SELECT.one) return res.sendStatus(204)
        if (_propertyAccess && result[_propertyAccess] == null) return res.sendStatus(204)

        // 304
        if (validateIfNoneMatch(cdsReq.target, req.headers?.['if-none-match'], result)) return res.sendStatus(304)

        if (result == null) {
          result = []
          if (req.query.$count) result.$count = 0
        } else if (query.SELECT.count && !result.$count) {
          result.$count = 0
        }

        if (!one) _setNextLink(cdsReq, result)
        postProcess(cdsReq.target, model, result)
        if (result?.$etag) res.set('ETag', result.$etag) //> must be done after post processing

        const lastSeg = req.path.split('/').slice(-1)[0]
        if (lastSeg === '$count') return res.set('Content-Type', 'text/plain').send(_getCount(result).toString())
        if (lastSeg === '$value' && _propertyAccess) {
          if (cdsReq.target.elements[_propertyAccess].type === 'cds.Binary')
            return res.set('Content-Type', 'application/octet-stream').send(result[_propertyAccess])
          else return res.set('Content-Type', 'text/plain').send(result[_propertyAccess].toString())
        }

        const metadata = getODataMetadata(query, { result, isCollection: !one })
        result = getODataResult(result, metadata, { isCollection: !one, property: _propertyAccess })

        if (!result) throw new cds.error({ code: 404 })

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
