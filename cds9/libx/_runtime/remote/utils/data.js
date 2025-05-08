// Code adopted from @sap/cds-odata-v2-adapter-proxy
// https://www.w3.org/TR/xmlschema11-2/#nt-duDTFrag
const DurationRegex = /^P(?:(\d)Y)?(?:(\d{1,2})M)?(?:(\d{1,2})D)?T(?:(\d{1,2})H)?(?:(\d{2})M)?(?:(\d{2}(?:\.\d+)?)S)?$/i
const DataTypeOData = {
  Binary: 'cds.Binary',
  Boolean: 'cds.Boolean',
  Byte: 'cds.Binary',
  DateTime: 'cds.DateTime',
  DateTimeOffset: 'cds.Timestamp',
  Decimal: 'cds.Decimal',
  Double: 'cds.Double',
  Single: 'cds.Double',
  Guid: 'cds.UUID',
  Int16: 'cds.Integer',
  Int32: 'cds.Integer',
  Int64: 'cds.Integer64',
  SByte: 'cds.Integer',
  String: 'cds.String',
  Date: 'cds.Date',
  Time: 'cds.TimeOfDay'
}

const _convertData = (data, target, convertValueFn, returnType) => {
  const _convertRecordFn = returnType
    ? _convertActionFuncResponse(returnType, convertValueFn)
    : _getConvertRecordFn(target, convertValueFn)
  if (Array.isArray(data)) {
    return data.map(_convertRecordFn)
  }

  return _convertRecordFn(data)
}

const _getConvertRecordFn = (target, convertValueFn) => record => {
  for (const key in record) {
    if (key === '__metadata') continue

    const element = target.elements[key]
    if (!element) continue

    const recordValue = record[key]
    const value =
      (recordValue && typeof recordValue === 'object' && 'results' in recordValue && recordValue.results) || recordValue

    if (value && (element.isAssociation || Array.isArray(value))) {
      record[key] = _convertData(value, element._target, convertValueFn)
    } else {
      record[key] = convertValueFn(value, element)
    }
  }

  return record
}

const _convertActionFuncResponse = (returnType, convertValueFn) => data => {
  // return type is entity/complex type or array of entities/complex types
  if (returnType.elements || (returnType.items && returnType.items.elements)) {
    const _convertRecordFn = _getConvertRecordFn(returnType.items || returnType, convertValueFn)
    return _convertRecordFn(data)
  }
  // return type is primitive type/array of primitive types
  return convertValueFn(data, returnType.items || returnType)
}

const _convertValue = () => (value, element) => {
  if (value == null) return value

  const type = _elementType(element)

  if (type === 'cds.Time') {
    const match = value.match(DurationRegex)

    if (match) {
      value = `${match[4] || '00'}:${match[5] || '00'}:${match[6] || '00'}`
    }
  } else if (type === 'cds.Timestamp' || type === 'cds.DateTime' || type === 'cds.Date') {
    const match = value.match(/\/Date\((.*)\)\//)
    const ticksAndOffset = match && match.pop()

    if (ticksAndOffset) {
      value = new Date(_calculateTicksOffsetSum(ticksAndOffset)).toISOString() // always UTC
    }

    if (type === 'cds.DateTime') {
      value = value.slice(0, 19) + 'Z' // Cut millis
    } else if (type === 'cds.Date') {
      value = value.slice(0, 10) // Cut time
    }
  }

  return value
}

const _PT = ([hh, mm, ss]) => `PT${hh}H${mm}M${ss}S`

const _convertPayloadValue = (value, element) => {
  if (value == null) return value

  // see https://www.odata.org/documentation/odata-version-2-0/json-format/
  const type = _elementType(element)
  switch (type) {
    case 'cds.Time':
      return value.match(/^(PT)([H,M,S,0-9])*$/) ? value : _PT(value.split(':'))
    case 'cds.Decimal':
      return typeof value === 'string' ? value : `${value}`
    case 'cds.Date':
    case 'cds.DateTime':
      return `/Date(${new Date(value).getTime()})/`
    case 'cds.Binary':
    case 'cds.LargeBinary':
      return Buffer.isBuffer(value) ? value.toString('base64') : value
    case 'cds.Timestamp':
      // According to OData V2 spec, and as cds.DateTime => (V2) Edm.DateTimeOffset => cds.Timestamp,
      // cds.Timestamp should be converted into Edm.DateTimeOffset literal form `datetimeoffset'${new Date(value).toISOString()}'`
      // However, odata-v2-proxy forwards it literaly as `datetimeoffset'...'` which is rejected by okra.
      // Note that OData V2 spec example also does not contain 'datetimeoffset' predicate.
      return new Date(value).toISOString()
    default:
      return value
  }
}

const _calculateTicksOffsetSum = text => {
  return (text.replace(/\s/g, '').match(/[+-]?([0-9]+)/g) || []).reduce((sum, value, index) => {
    return sum + parseFloat(value) * (index === 0 ? 1 : 60 * 1000) // ticks are milliseconds (0), offset are minutes (1)
  }, 0)
}

const _elementType = element => {
  let type

  if (element) {
    type = element._type

    if (element['@odata.Type']) {
      const odataType = element['@odata.Type'].match(/\w+$/)
      type = (odataType && DataTypeOData[odataType[0]]) || type
    }

    if (!type && element.items && element.items._type) {
      type = element.items._type
    }
  }

  return type
}

const convertV2ResponseData = (data, target, returnType) => {
  if (!((target && target.elements) || returnType)) return data
  return _convertData(data, target, _convertValue(), returnType)
}

const convertV2PayloadData = (data, target) => {
  if (!target || !target.elements) return data
  return _convertData(data, target, _convertPayloadValue)
}

const deepSanitize = arg => {
  if (Array.isArray(arg)) return arg.map(deepSanitize)
  if (typeof arg === 'object' && arg !== null)
    return Object.keys(arg).reduce((acc, cur) => {
      acc[cur] = deepSanitize(arg[cur])
      return acc
    }, {})
  return '***'
}

const hasAliasedColumns = (column = {}) => {
  return column.as || (column.expand && column.expand.some(hasAliasedColumns))
}

module.exports = {
  convertV2ResponseData,
  convertV2PayloadData,
  deepSanitize,
  hasAliasedColumns
}
