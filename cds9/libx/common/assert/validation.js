const { cds } = global

const {
  'cds.Date': checkISODate,
  'cds.Time': checkISOTime,
  'cds.DateTime': checkISODateTime,
  'cds.Timestamp': checkISOTimestamp,
  'cds.String': checkString
} = require('./type-strict')
const { getTarget, resolveCDSType } = require('./utils')

const _isNavigationColumn = (col, as) => col.ref?.length > 1 && (col.as === as || col.ref[col.ref.length - 1] === as)

// REVISIT: mandatory is actually not the same as not null or empty string
const _isNotFilled = val => val === null || val === undefined || (typeof val === 'string' && val.trim() === '')

const _getEnumElement = ele => ((ele['@assert.range'] && ele.enum) ? ele.enum : undefined)

const _enumValues = ele => {
  return Object.keys(ele).map(enumKey => {
    const enum_ = ele[enumKey]
    const enumValue = enum_ && enum_.val
    if (enumValue !== undefined) {
      if (enumValue['=']) return enumValue['=']
      if (enum_ && enum_.literal && enum_.literal === 'number') return Number(enumValue)
      return enumValue
    }
    return enumKey
  })
}

const _checkDateValue = (val, r1, r2) => {
  const dateVal = new Date(val)
  return (dateVal - new Date(r1)) * (dateVal - new Date(r2)) <= 0
}

const _toDate = val => `2000-01-01T${val}Z`

const _checkInRange = (val, range, type) => {
  switch (type) {
    case 'cds.Date':
      return checkISODate(val) && _checkDateValue(val, range[0], range[1])
    case 'cds.DateTime':
      return checkISODateTime(val) && _checkDateValue(val, range[0], range[1])
    case 'cds.Timestamp':
      return checkISOTimestamp(val) && _checkDateValue(val, range[0], range[1])
    case 'cds.Time':
      return checkISOTime(val) && _checkDateValue(_toDate(val), _toDate(range[0]), _toDate(range[1]))
    default:
      return (val - range[0]) * (val - range[1]) <= 0
  }
}

// process.env.CDS_ASSERT_FORMAT_FLAGS is not official!
const _checkRegExpFormat = (val, format) =>
  checkString(val) && val.match(new RegExp(format, process.env.CDS_ASSERT_FORMAT_FLAGS || 'u'))

const checkMandatory = (v, ele, errs, path, k) => {
  // REVISIT: correct to not complain?
  // do not complain about missing foreign keys in children
  if (path.length && ele['@odata.foreignKey4']) return

  // TODO: which case is this?
  // do not complain about ???
  if (ele.parent?.query?.SELECT?.columns?.find(col => _isNavigationColumn(col, ele.name))) return

  if (_isNotFilled(v)) {
    const target = getTarget(path, k)
    errs.push(new cds.error('ASSERT_NOT_NULL', { target, statusCode: 400, code: '400' }))
  }
}

const checkEnum = (v, ele, errs, path, k) => {
  const enumElements = _getEnumElement(ele)
  const enumValues = enumElements && _enumValues(enumElements)
  if (enumElements && !enumValues.some(ev => ev == v)) { //> use == for automatic type coercion
    const args =
      typeof v === 'string'
        ? ['"' + v + '"', enumValues.map(ele => '"' + ele + '"').join(', ')]
        : [v, enumValues.join(', ')]
    const target = getTarget(path, k)
    errs.push(new cds.error('ASSERT_ENUM', { args, target, statusCode: 400, code: '400' }))
  }
}

const checkRange = (v, ele, errs, path, k) => {
  const rangeElements = ele['@assert.range'] && !_getEnumElement(ele) ? ele['@assert.range'] : undefined
  if (rangeElements && !_checkInRange(v, rangeElements, resolveCDSType(ele))) {
    const args = [v, ...ele['@assert.range']]
    const target = getTarget(path, k)
    errs.push(new cds.error('ASSERT_RANGE', { args, target, statusCode: 400, code: '400' }))
  }
}

const checkFormat = (v, ele, errs, path, k) => {
  const formatElements = ele['@assert.format']
  if (formatElements && !_checkRegExpFormat(v, formatElements)) {
    const args = [v, formatElements]
    const target = getTarget(path, k)
    errs.push(new cds.error('ASSERT_FORMAT', { args, target, statusCode: 400, code: '400' }))
  }
}

module.exports = {
  checkMandatory,
  checkEnum,
  checkRange,
  checkFormat
}
