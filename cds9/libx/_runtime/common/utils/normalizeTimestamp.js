const cds = require('../../cds')
const PRECISION = cds.env.features.precise_timestamps ? 7 : 3

const TZ_REGEX = new RegExp(/(Z|[+-][01]\d:?[0-5]\d)$/)
const NON_DIGIT_REGEX = new RegExp(/\D/, 'g')

const _lengthIfNotFoundIndex = (index, length) => (index > -1 ? index : length)

module.exports = value => {
  if (value instanceof Date) value = value.toISOString()
  if (typeof value === 'number') value = new Date(value).toISOString()

  const decimalPointIndex = _lengthIfNotFoundIndex(value.lastIndexOf('.'), value.length)
  const tzRegexMatch = TZ_REGEX.exec(value)
  const tz = tzRegexMatch?.[0] || ''
  const tzIndex = _lengthIfNotFoundIndex(tzRegexMatch?.index, value.length)
  const dateEndIndex = Math.min(decimalPointIndex, tzIndex)
  const dateNoMillisNoTZ = new Date(value.slice(0, dateEndIndex) + tz).toISOString().slice(0, 19)
  const normalizedFractionalDigits = value
    .slice(dateEndIndex + 1, tzIndex)
    .replace(NON_DIGIT_REGEX, '')
    .padEnd(PRECISION, '0')
    .slice(0, PRECISION)
  return dateNoMillisNoTZ + (normalizedFractionalDigits ? '.' + normalizedFractionalDigits : '') + 'Z'
}
