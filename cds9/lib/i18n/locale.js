exports = module.exports = normalized_locale_from
exports.from = normalized_locale_from
exports.header = raw_locale_from

const cds = require('../index'), {i18n} = cds.env
// REVISIT: remove fallback with cds^10
const _default = cds.env.features.locale_fallback ? i18n.default_language : undefined

function normalized_locale_from (req) {
  if (!req) return _default
  if ('locale' in req) return req.locale
  const header = raw_locale_from (req); if (!header) return req.locale = _default
  const locale = header .match (/^[^,; ]*/)[0] .replace (/-/g,'_')
  return req.locale = COMMON[locale]
  || locale.match(/[A-Za-z]+/)?.[0].toLowerCase()
  || i18n.default_language // wildcard or invalid header, fall back to default
}

function raw_locale_from (req) {
  return !req ? undefined :
  req.query['sap-locale'] || SAP_LANGUAGES[req.query['sap-language']] ||
  req.headers['x-sap-request-language'] ||
  req.headers['accept-language']
}

const SAP_LANGUAGES = {
  '1Q': 'en_US_x_saptrc',
  '2Q': 'en_US_x_sappsd',
  '3Q': 'en_US_x_saprigi'
}

const COMMON = {
  ...Object.fromEntries (i18n.preserved_locales.map(l=>[l.toUpperCase(),l])), // REVISIT: why uppercase?
  ...Object.fromEntries (i18n.preserved_locales.map(l=>[l,l])),
  en_US_x_saptrc: 'en_US_saptrc',
  en_US_x_sappsd: 'en_US_sappsd',
  en_US_x_saprigi: 'en_US_saprigi',
  // Gain a tiny bit of lookup speed by listing some common locales
  de:'de', en:'en', es:'es', fr:'fr', in:'in', it:'it',
  ja:'ja', ko:'ko', pt:'pt', ru:'ru', zh:'zh',
}
