// TODO: split into multiple files

const cds = require('../../../')
const _etag = require('./etag')

const { toBase64url } = require('../../_runtime/common/utils/binary')
const { getSapMessages } = require('../middleware/error')

// copied from cds-compiler/lib/edm/edmUtils.js
const cds2edm = {
  'cds.String': 'Edm.String',
  // 'cds.hana.NCHAR': 'Edm.String',
  'cds.LargeString': 'Edm.String',
  // 'cds.hana.VARCHAR': 'Edm.String',
  // 'cds.hana.CHAR': 'Edm.String',
  // 'cds.hana.CLOB': 'Edm.String',
  'cds.Binary': 'Edm.Binary',
  // 'cds.hana.BINARY': 'Edm.Binary',
  'cds.LargeBinary': 'Edm.Binary',
  'cds.Decimal': 'Edm.Decimal',
  'cds.DecimalFloat': 'Edm.Decimal',
  // 'cds.hana.SMALLDECIMAL': 'Edm.Decimal', // V4: Scale="floating" Precision="16"
  'cds.Integer64': 'Edm.Int64',
  'cds.Integer': 'Edm.Int32',
  'cds.Int64': 'Edm.Int64',
  'cds.Int32': 'Edm.Int32',
  'cds.Int16': 'Edm.Int16',
  'cds.UInt8': 'Edm.Byte',
  // 'cds.hana.SMALLINT': 'Edm.Int16',
  // 'cds.hana.TINYINT': 'Edm.Byte',
  'cds.Double': 'Edm.Double',
  // 'cds.hana.REAL': 'Edm.Single',
  'cds.Date': 'Edm.Date',
  'cds.Time': 'Edm.TimeOfDay',
  'cds.DateTime': 'Edm.DateTimeOffset',
  'cds.Timestamp': 'Edm.DateTimeOffset',
  'cds.Boolean': 'Edm.Boolean',
  'cds.UUID': 'Edm.Guid'
  // 'cds.hana.ST_POINT': 'Edm.GeometryPoint',
  // 'cds.hana.ST_GEOMETRY': 'Edm.Geometry',
}

const getSafeNumber = inputString => {
  if (typeof inputString !== 'string') return inputString
  // Try to parse the input string as a floating-point number using parseFloat
  const parsedFloat = parseFloat(inputString)

  // Check if the parsed value is not NaN and is equal to the original input string
  if (!isNaN(parsedFloat) && String(parsedFloat) === inputString) {
    return parsedFloat
  }

  // Try to parse the input string as an integer using parseInt
  const parsedInt = parseInt(inputString)
  // special case like '3.00000000000001', the precision is not lost and string is returned
  if (!isNaN(parsedInt) && String(parsedInt) === inputString.replace(/^-?\d+\.0+$/, inputString.split('.')[0])) {
    return parsedInt
  }

  // If none of the above conditions are met, return the input string as is
  return inputString
}

const _getElement = (csnTarget, key) => {
  if (csnTarget) {
    if (csnTarget.elements) {
      if (Array.isArray(key)) {
        const [navigation, ...targetElement] = key
        const element = csnTarget.elements[navigation]
        if (element && element.isAssociation) {
          return _getElement(
            csnTarget.elements[navigation]._target,
            targetElement.length > 1 ? targetElement : targetElement[0]
          )
        } else if (element && element._isStructured) {
          return _getElement(
            csnTarget.elements[navigation],
            targetElement.length > 1 ? targetElement : targetElement[0]
          )
        }
      }
      return (
        csnTarget.elements[key] || {
          type: undefined
        }
      )
    } else if (csnTarget.params) {
      return (
        csnTarget.params[key] || {
          type: undefined
        }
      )
    }
  }

  return {
    type: undefined
  }
}

const getPreferReturnHeader = req => {
  const preferReturn = req.headers.prefer?.match(/\W?return=(\w+)/i)
  if (preferReturn) return preferReturn[1]
}

const _PT = ([hh, mm, ss]) => `PT${hh}H${mm}M${ss}S`

const _v2 = (val, element) => {
  switch (element.type) {
    case 'cds.UUID':
      return `guid'${val}'`
    // binaries
    case 'cds.Binary':
    case 'cds.LargeBinary':
      return `binary'${toBase64url(val)}'`
    // integers
    case 'cds.UInt8':
    case 'cds.Int16':
    case 'cds.Int32':
    case 'cds.Integer':
      return val
    // big integers
    case 'cds.Int64':
    case 'cds.Integer64':
      // inofficial flag to skip appending "L"
      return cds.env.remote?.skip_v2_appendix ? val : `${val}L`.replace(/ll$/i, 'L')
    // floating point numbers
    case 'cds.Decimal':
      // inofficial flag to skip appending "m"
      return cds.env.remote?.skip_v2_appendix ? val : `${val}m`.replace(/mm$/i, 'm')
    case 'cds.Double':
      // inofficial flag to skip appending "d"
      return cds.env.remote?.skip_v2_appendix ? val : `${val}d`.replace(/dd$/i, 'd')
    // dates et al
    case 'cds.Date':
      return element['@odata.Type'] === 'Edm.DateTimeOffset'
        ? `datetimeoffset'${val}T00:00:00'`
        : `datetime'${val}T00:00:00'`
    case 'cds.DateTime':
      return element['@odata.Type'] === 'Edm.DateTimeOffset'
        ? `datetimeoffset'${val}'`
        : val.endsWith('Z')
          ? `datetime'${val.slice(0, -1)}'`
          : `datetime'${val}'`
    case 'cds.Time':
      return `time'${_PT(val.split(':'))}'`
    case 'cds.Timestamp':
      return element['@odata.Type'] === 'Edm.DateTime'
        ? val.endsWith('Z')
          ? `datetime'${val.slice(0, -1)}'`
          : `datetime'${val}'`
        : `datetimeoffset'${val}'`
    // bool
    case 'cds.Boolean':
      return val
    // strings + default to string representation
    case 'cds.String':
    case 'cds.LargeString':
    default:
      return `'${val}'`
  }
}

const _v4 = (val, element) => {
  switch (element.type) {
    case 'cds.UUID':
      return val
    // binary
    case 'cds.Binary':
    case 'cds.LargeBinary':
      return `binary'${toBase64url(val)}'`
    // integers
    case 'cds.UInt8':
    case 'cds.Int16':
    case 'cds.Int32':
    case 'cds.Integer':
      return val
    // big integers
    case 'cds.Int64':
    case 'cds.Integer64':
      return val
    // floating point numbers
    case 'cds.Decimal':
    case 'cds.Double':
      return val
    // dates et al
    case 'cds.DateTime':
    case 'cds.Date':
    case 'cds.Timestamp':
    case 'cds.Time':
      return val
    // bool
    case 'cds.Boolean':
      return val
    // strings + default to string representation
    case 'cds.String':
    case 'cds.LargeString':
    default:
      return `'${val}'`
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MATH_FUNC = { round: 1, floor: 1, ceiling: 1 }

const _isTimestamp = val =>
  /^\d+-\d\d-\d\d(T\d\d:\d\d(:\d\d(\.\d+)?)?(Z|([+-]{1}\d\d:\d\d))?)?$/.test(val) && !isNaN(Date.parse(val))

const formatVal = (val, elementName, csnTarget, kind, func, literal) => {
  if (val === null || val === 'null') return 'null'
  if (typeof val === 'boolean') return val
  if (typeof val === 'string' && literal === 'number') return `${val}`
  if (typeof val === 'string') {
    if (!csnTarget && UUID.test(val)) return kind === 'odata-v2' ? `guid'${val}'` : val
    if (func in MATH_FUNC) return val
  }
  if (typeof val === 'number') val = getSafeNumber(val)
  if (!csnTarget) {
    if (typeof val !== 'string') return val
    // REVISIT: why do we need to check strings for timestamps?
    if (_isTimestamp(val)) return val
    return `'${val}'`
  }
  const element = _getElement(csnTarget, elementName)
  if (!element?.type) return typeof val === 'string' ? `'${val}'` : val
  if ((element.type === 'cds.LargeString' || element.type === 'cds.String') && val.indexOf("'") >= 0)
    val = val.replace(/'/g, "''")
  return kind === 'odata-v2' ? _v2(val, element) : _v4(val, element)
}

const skipToken = (token, cqn) => {
  const LOG = cds.log('odata')
  if (isNaN(token)) {
    let decoded
    try {
      decoded = JSON.parse(Buffer.from(token, 'base64').toString())
    } catch {
      LOG.warn('$skiptoken is not in expected format. Ignoring it.')
      return
    }
    const xprs = decoded.c.map(() => [])

    for (let i = 0; i < xprs.length; i++) {
      const { k, v, a } = decoded.c[i]
      const ref = { ref: [k] }
      const val = { val: v }

      if (i > 0) xprs[i].push('and')
      xprs[i].push(ref, a ? '>' : '<', val)

      for (let j = i + 1; j < xprs.length; j++) {
        if (i > 0) xprs[j].push('and')
        xprs[j].push(ref, '=', val)
      }
    }

    const xpr = []
    for (let i = 0; i < xprs.length; i++) {
      if (i > 0) xpr.push('or')
      xpr.push(...xprs[i])
    }

    if (cqn.SELECT.where) {
      cqn.SELECT.where = [{ xpr: [...cqn.SELECT.where] }, 'and', { xpr }]
    } else {
      cqn.SELECT.where = [{ xpr }]
    }

    if (cds.context?.http.req.query.$top) {
      const top = parseInt(cds.context?.http.req.query.$top)
      if (top - decoded.r < cqn.SELECT.limit.rows.val) {
        cqn.SELECT.limit.rows.val = top - decoded.r
      }
    }
  } else {
    const { limit } = cqn.SELECT
    if (!limit) {
      cqn.SELECT.limit = { offset: { val: parseInt(token) } }
    } else {
      const { offset } = limit
      cqn.SELECT.limit.offset = { val: (offset && 'val' in offset ? offset.val : offset || 0) + parseInt(token) }
    }
  }
}

// REVISIT: When does that have to happen? -> always? or for OData v2 only?
const handleSapMessages = (cdsReq, req, res) => {
  if (res.headersSent || !cdsReq.messages?.length) return
  const msgs = getSapMessages(cdsReq.messages, req)
  if (msgs) res.setHeader('sap-messages', msgs)
}

const isStream = query => {
  if (!query) return
  const { _propertyAccess } = query
  if (!_propertyAccess) return

  // FIXME: that should not be done in middlewares, but only in an event handler, after ensure_target
  const element = cds.infer.target(query).elements?.[_propertyAccess]
  return element._type === 'cds.LargeBinary' && element['@Core.MediaType']
}

const isRedirect = query => {
  const { _propertyAccess } = query
  if (!_propertyAccess) return

  // FIXME: that should not be done in middlewares, but only in an event handler, after ensure_target
  const element = cds.infer.target(query).elements?.[_propertyAccess]
  return element['@Core.IsURL']
}

const _addKeysDeep = (keys, keysCollector, ignoreManagedBackLinks) => {
  for (const keyName in keys) {
    const key = keys[keyName]
    const foreignKey = key._foreignKey4
    if (key.isAssociation || foreignKey === 'up_' || key['@cds.api.ignore'] === true) continue

    if (ignoreManagedBackLinks && foreignKey) {
      const navigationElement = keys[foreignKey]
      if (!navigationElement.on && navigationElement._isBacklink) {
        // skip navigation elements that are backlinks
        continue
      }
    }

    if ('elements' in key) {
      _addKeysDeep(key.elements, keysCollector)
      continue
    }

    keysCollector.push(keyName)
  }
}

function keysOf(entity, ignoreManagedBackLinks) {
  const keysCollector = []
  if (!entity || !entity.keys) return keysCollector

  _addKeysDeep(entity.keys, keysCollector, ignoreManagedBackLinks)
  return keysCollector
}

// case: single key without name, e.g., Foo(1)
function addRefToWhereIfNecessary(where, entity, ignoreManagedBackLinks = false) {
  if (!where || where.length !== 1) return 0

  const isView = !!entity.params
  const keys = isView ? Object.keys(entity.params) : keysOf(entity, ignoreManagedBackLinks)

  if (keys.length !== 1) return 0
  where.unshift(...[{ ref: [keys[0]] }, '='])
  return 1
}

function getBoundary(req) {
  return req.headers['content-type']?.match(/boundary=([\d\w'()+_,\-./:=?]{1,70})/i)?.[1]
}

module.exports = {
  cds2edm,
  getSafeNumber,
  formatVal,
  skipToken,
  handleSapMessages,
  getPreferReturnHeader,
  isStream,
  isRedirect,
  keysOf,
  addRefToWhereIfNecessary,
  validateIfNoneMatch: _etag.validateIfNoneMatch,
  extractIfNoneMatch: _etag.extractIfNoneMatch,
  getBoundary
}
