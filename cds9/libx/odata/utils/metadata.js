const cds = require('../../../lib')
const LOG = cds.log('odata')
const { appURL } = require('../../_runtime/common/utils/vcap')
const { cds2edm } = require('./index')
const { where2obj } = require('../../_runtime/common/utils/cqn')

const _getContextAbsoluteUrl = _req => {
  const { contextAbsoluteUrl } = cds.env.odata
  if (!contextAbsoluteUrl) return ''

  if (typeof contextAbsoluteUrl === 'string') {
    try {
      const userDefinedURL = new URL(contextAbsoluteUrl, contextAbsoluteUrl).toString()
      return (!userDefinedURL.endsWith('/') && `${userDefinedURL}/`) || userDefinedURL
    } catch (e) {
      e.message = `cds.odata.contextAbsoluteUrl could not be parsed as URL: ${contextAbsoluteUrl}`
      LOG._warn && LOG.warn(e)
    }
  }
  const reqURL = _req && _req.get && _req.get('host') && `${_req.protocol || 'https'}://${_req.get('host')}`
  const baseAppURL = appURL || reqURL || ''
  const serviceUrl = `${(_req && _req.baseUrl) || ''}/`
  return baseAppURL && new URL(serviceUrl, baseAppURL).toString()
}

const _isNavToDraftAdmin = path => path.length > 1 && path[path.length - 1] === 'DraftAdministrativeData'

const _lastValidRef = ref => {
  for (let i = ref.length - 1; i >= 0; i--) {
    if (ref[i] in { DraftAdministrativeData: 1, SiblingEntity: 1 }) continue
    return ref[i]
  }
}

const _toBinaryKeyValue = value => `binary'${value.toString('base64')}'`

const _odataContext = (query, options) => {
  const { contextAbsoluteUrl, context_with_columns } = cds.env.odata

  let path = _getContextAbsoluteUrl(query._req) + '$metadata'
  if (query._target.kind === 'service') return path

  const {
    _target: { _isSingleton: isSingleton },
    _propertyAccess: propertyAccess
  } = query

  const { result, isCollection } = options

  path += '#'

  // REVISIT: subselect is treated as empty array
  const ref =
    query.SELECT?.from?.ref ?? query.UPDATE?.entity?.ref ?? query.INSERT?.into?.ref ?? query.DELETE?.from?.ref ?? []

  const isNavToDraftAdmin = _isNavToDraftAdmin(ref)

  let edmName
  if (options.edmName) edmName = options.edmName
  else if (isNavToDraftAdmin) edmName = ref[0].id ?? ref[0]
  else if (cds2edm[query._target.type]) edmName = cds2edm[query._target.type]
  else edmName = query._target.name

  const isType = query._target.kind === 'type'
  if (isCollection && isType) edmName = `Collection(${edmName})`

  const serviceName = query._target._service?.name
  if (serviceName && !isType) edmName = edmName.replace(serviceName + '.', '').replace(/\./g, '_')

  // prepend "../" parent segments for relative path
  if (!contextAbsoluteUrl && ref.length > 1) path = '../'.repeat(ref.length - 1) + path

  path += edmName

  const isViewWithParams = query._target.kind === 'entity' && query._target.params
  if (propertyAccess || isNavToDraftAdmin || isViewWithParams) {
    if (!contextAbsoluteUrl && (propertyAccess || isViewWithParams)) path = '../' + path

    const keyValuePairs = []

    const lastValidRef = _lastValidRef(ref)
    const lastRef = ref.at(-1)
    const isSibling = lastRef === 'SiblingEntity'
    let _keyValuePairs
    if (lastValidRef.where) {
      _keyValuePairs = Object.entries(where2obj(lastValidRef.where))
    } else if (isViewWithParams) {
      _keyValuePairs = Object.entries(lastValidRef.args).map(([k, v]) => [k, v.val])
    } else if (!isSingleton) {
      // use keys from result if not in query
      _keyValuePairs = Object.entries(query._target.keys)
        .filter(([, v]) => !v._isBacklink)
        .map(([k]) => [k, result[k]])
    }

    if (Array.isArray(_keyValuePairs)) {
      _keyValuePairs.forEach(([k, _v]) => {
        const v = (() => {
          if (k === 'IsActiveEntity' && isSibling) return !_v
          if (Buffer.isBuffer(_v)) return _toBinaryKeyValue(_v)
          return _v
        })()
        if (v !== undefined) keyValuePairs.push([k, v])
      })
    }

    if (keyValuePairs.length) {
      let keyString
      // single keys just contain the value
      if (keyValuePairs.length === 1) keyString = String(keyValuePairs[0][1])
      // multiple keys should contain key value pairs
      else keyString = keyValuePairs.map(([k, v]) => `${k}=${v}`).join(',')
      path += '(' + keyString + ')'
    }

    if (isNavToDraftAdmin) path += '/' + lastRef
    if (propertyAccess) path += '/' + propertyAccess
    if (isViewWithParams) path += '/Set'
  }

  if (context_with_columns && query.SELECT && !propertyAccess) {
    const _calculateStringFromColumn = column => {
      if (column === '*') return

      const refName = column.ref?.[0]

      if (column.expand) {
        // Process nested expands recursively
        const expands = _calculateColumnsString(column.expand)
        return `${refName}${expands ? expands : '()'}`
      } else if (column.func) {
        return column.as
      }

      return refName
    }

    const _calculateColumnsString = columns => {
      const selects = []
      const expands = []
      columns.forEach(column => {
        if (column.expand) expands.push(column)
        else selects.push(column)
      })

      const columnStrings = []

      // First process selects, then expands
      selects.concat(expands).forEach(column => {
        const stringFromColumn = _calculateStringFromColumn(column)
        if (stringFromColumn) columnStrings.push(stringFromColumn)
      })

      if (columnStrings.length) return `(${columnStrings.join(',')})`
    }

    const columns = query.SELECT.columns || query.SELECT.from?.SELECT?.columns
    if (columns) {
      const columnsString = _calculateColumnsString(columns)
      if (columnsString) path += columnsString
    }
  }

  if (!isCollection && !isSingleton && !propertyAccess && !isType) path += '/$entity'

  return path
}

/**
 * TODO
 *
 * @param {*} query
 * @param {*} [options]
 * @param {*} [options.result]
 * @param {*} [options.isCollection]
 * @param {*} [options.edmName]
 * @returns
 */
module.exports = function getODataMetadata(query, options = {}) {
  if (!query._target) return

  const context = _odataContext(query, options)

  return { context }
}
