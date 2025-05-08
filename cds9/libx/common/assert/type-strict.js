const { cds } = global

const { Readable } = require('stream')

const { getNormalizedDecimal, getTarget, isBase64String } = require('./utils')

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i //> "i" is acutally not OK, but we'll leave as is for now to avoid breaking changes
const RELAXED_UUID_REGEX = /^[0-9a-z]{8}-?[0-9a-z]{4}-?[0-9a-z]{4}-?[0-9a-z]{4}-?[0-9a-z]{12}$/i

const ISO_DATE_PART1 =
  '[1-9]\\d{3}-(?:(?:0[1-9]|1[0-2])-(?:0[1-9]|1\\d|2[0-8])|(?:0[13-9]|1[0-2])-(?:29|30)|(?:0[13578]|1[02])-31)'
const ISO_DATE_PART2 = '(?:[1-9]\\d(?:0[48]|[2468][048]|[13579][26])|(?:[2468][048]|[13579][26])00)-02-29'
const ISO_DATE = `(?:${ISO_DATE_PART1}|${ISO_DATE_PART2})`
const ISO_TIME_NO_MILLIS = '(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d'
const ISO_TIME = `${ISO_TIME_NO_MILLIS}(?:\\.\\d{1,9})?`
const ISO_DATE_TIME = `${ISO_DATE}T${ISO_TIME_NO_MILLIS}(?:Z|[+-][01]\\d:?[0-5]\\d)`
const ISO_TIMESTAMP = `${ISO_DATE}T${ISO_TIME}(?:Z|[+-][01]\\d:?[0-5]\\d)`
const ISO_DATE_REGEX = new RegExp(`^${ISO_DATE}$`, 'i')
const ISO_TIME_NO_MILLIS_REGEX = new RegExp(`^${ISO_TIME_NO_MILLIS}$`, 'i')
const ISO_DATE_TIME_REGEX = new RegExp(`^${ISO_DATE_TIME}$`, 'i')
const ISO_TIMESTAMP_REGEX = new RegExp(`^${ISO_TIMESTAMP}$`, 'i')

const _checkString = value => typeof value === 'string'

const _checkNumber = value => typeof value === 'number' && !Number.isNaN(value)

const _oldCheckDecimal = (value, element) => {
  const [left, right] = String(value).split('.')
  return (
    _checkNumber(value) &&
    (!element.precision || left.length <= element.precision - (element.scale || 0)) &&
    (!element.scale || ((right || '').length <= element.scale && parseFloat(right) !== 0))
  )
}

// REVISIT: only use a cheaper check if not in strictDecimal mode?
const _checkDecimal = (v, ele, errs, path, k) => {
  if (!errs) return _oldCheckDecimal(v, ele)

  const { precision, scale } = ele
  let val = getNormalizedDecimal(v)
  if (precision != null && scale != null) {
    let isValid = true
    if (!val.match(/\./)) val += '.0'
    if (precision === scale) {
      if (!val.match(new RegExp(`^-?0\\.\\d{0,${scale}}$`, 'g'))) isValid = false
    } else if (scale === 0) {
      if (!val.match(new RegExp(`^-?\\d{1,${precision - scale}}\\.0{0,1}$`, 'g'))) isValid = false
    } else if (!val.match(new RegExp(`^-?\\d{1,${precision - scale}}\\.\\d{0,${scale}}$`, 'g'))) {
      isValid = false
    }
    if (!isValid) {
      const args = [v, `Decimal(${precision},${scale})`]
      const target = getTarget(path, k)
      errs.push(new cds.error('ASSERT_DATA_TYPE', { args, target, statusCode: 400, code: '400' }))
    }
  } else if (precision != null) {
    if (!val.match(new RegExp(`^-?\\d{1,${precision}}$`, 'g'))) {
      const args = [v, `Decimal(${precision})`]
      const target = getTarget(path, k)
      errs.push(new cds.error('ASSERT_DATA_TYPE', { args, target, statusCode: 400, code: '400' }))
    }
  }
}

const _checkInt = value => _checkNumber(value) && parseInt(value, 10) === value

const _checkInt64 = value => typeof value === 'string' ? value.match(/^\d+$/) : _checkInt(value)

const _checkBoolean = value => typeof value === 'boolean'

const _checkBuffer = value => Buffer.isBuffer(value) || value.type === 'Buffer' || isBase64String(value)

const _checkStreamOrBuffer = value => value instanceof Readable || _checkBuffer(value)

const _checkUUID = value => _checkString(value) && UUID_REGEX.test(value)

const _checkRelaxedUUID = value => _checkString(value) && RELAXED_UUID_REGEX.test(value)

const _checkISODate = value => (_checkString(value) && ISO_DATE_REGEX.test(value)) || value instanceof Date

const _checkISOTime = value => _checkString(value) && ISO_TIME_NO_MILLIS_REGEX.test(value)

const _checkISODateTime = value => (_checkString(value) && ISO_DATE_TIME_REGEX.test(value)) || value instanceof Date

const _checkISOTimestamp = value => (_checkString(value) && ISO_TIMESTAMP_REGEX.test(value)) || value instanceof Date

module.exports = {
  'cds.UUID': _checkUUID,
  'relaxed.UUID': _checkRelaxedUUID,
  'cds.Boolean': _checkBoolean,
  'cds.Integer': _checkInt,
  'cds.UInt8': _checkInt,
  'cds.Int16': _checkInt,
  'cds.Int32': _checkInt,
  'cds.Integer64': _checkInt64,
  'cds.Int64': _checkInt64,
  'cds.Decimal': _checkDecimal,
  'cds.DecimalFloat': _checkNumber,
  'cds.Double': _checkNumber,
  'cds.Date': _checkISODate,
  'cds.Time': _checkISOTime,
  'cds.DateTime': _checkISODateTime,
  'cds.Timestamp': _checkISOTimestamp,
  'cds.String': _checkString,
  'cds.Binary': _checkBuffer,
  'cds.LargeString': _checkString,
  'cds.LargeBinary': _checkStreamOrBuffer
}
