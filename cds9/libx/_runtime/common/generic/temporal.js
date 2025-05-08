const cds = require('../../cds')
const normalizeTimestamp = require('../utils/normalizeTimestamp')

const _getDateFromQueryOptions = str => {
  if (str) {
    const match = str.match(/^date'(.+)'$/)
    // REVISIT: What happens with invalid date values in query parameter? if match.length > 1
    return normalizeTimestamp(match ? match[1] : str)
  }
}

const _isDate = dateStr => !dateStr.includes(':')
const _isTimestamp = dateStr => dateStr.includes('.')
const _isAsOfNow = queryOptions =>
  !queryOptions || (!queryOptions['sap-valid-at'] && !queryOptions['sap-valid-to'] && !queryOptions['sap-valid-from'])

const _getTimeDelta = (target, queryOption) => {
  if (!target || !target.elements || !queryOption) return 1000

  if (
    _isDate(queryOption) ||
    Object.values(target.elements).some(el => el['@cds.valid.from'] && el._type === 'cds.Date')
  ) {
    return 1000 * 60 * 60 * 24
  }

  if (
    _isTimestamp(queryOption) &&
    Object.values(target.elements).some(el => el['@cds.valid.from'] && el._type === 'cds.Timestamp')
  ) {
    return 1
  }
  // for cds.DateTime
  return 1000
}

/**
 * Generic handler for entities using temporal aspect
 *
 * @param req
 */
function handle_temporal_data(req) {
  const _queryOptions = req.req?.query

  // REVISIT: stable access
  const _ = (req.context && req.context._) || req._

  // make sure the env vars are reset
  _['VALID-FROM'] = null
  _['VALID-TO'] = null

  if (_isAsOfNow(_queryOptions)) {
    const date = new Date()
    _['VALID-FROM'] = normalizeTimestamp(date)
    _['VALID-TO'] = normalizeTimestamp(date.getTime() + _getTimeDelta(req.target))
  } else if (_queryOptions['sap-valid-at']) {
    const dateAsIsoString = _getDateFromQueryOptions(_queryOptions['sap-valid-at'])
    _['VALID-FROM'] = dateAsIsoString

    if (cds.env.features.precise_timestamps) {
      const nanos = dateAsIsoString.slice(-5)
      // we would lose the nano precision here, so we just cut it off before and attach it again here
      _['VALID-TO'] =
        normalizeTimestamp(
          new Date(dateAsIsoString).getTime() + _getTimeDelta(req.target, _queryOptions['sap-valid-at'])
        ).slice(0, -5) + nanos
    } else {
      _['VALID-TO'] = normalizeTimestamp(
        new Date(dateAsIsoString).getTime() + _getTimeDelta(req.target, _queryOptions['sap-valid-at'])
      )
    }
  } else if (_queryOptions['sap-valid-from'] || _queryOptions['sap-valid-to']) {
    _['VALID-FROM'] = normalizeTimestamp(
      _getDateFromQueryOptions(_queryOptions['sap-valid-from'] ?? normalizeTimestamp('0001-01-01T00:00:00.0000000Z'))
    )
    _['VALID-TO'] = normalizeTimestamp(
      _getDateFromQueryOptions(_queryOptions['sap-valid-to'] ?? normalizeTimestamp('9999-12-31T23:59:59.9999999Z'))
    )
  }

  // REVISIT: needed without okra
  if (req.constructor.name !== 'ODataRequest') {
    req._['VALID-FROM'] = _['VALID-FROM']
    req._['VALID-TO'] = _['VALID-TO']
  }
}
handle_temporal_data._initial = true

/**
 * handler registration
 */
module.exports = cds.service.impl(function () {
  // Register handler only if at least one entity has temporal annotation
  let temporal_required = false
  for (const each of this.entities) {
    for (const element of each.elements) {
      if (element['@cds.valid.from'] || element['@cds.valid.to']) {
        temporal_required = true
        break
      }
    }
    if (temporal_required) break
  }
  if (temporal_required) this.before('READ', '*', handle_temporal_data)
})
