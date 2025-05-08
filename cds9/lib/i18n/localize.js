const cds = require('..'), {i18n} = cds

/**
 * Fluent API to localize {i18n>...} placeholders in arbitrary strings.
 * - All fluent methods are optional and can be chained in any order.
 * @example
 * let all = cds.localize ('<b>{i18n>CreatedBy}:</b> ...')
 *   .from (cds.model)
 *   .for ('de','en')
 *   .with (cds.i18n.labels)
 *   .with (cds.i18n.labels.translations4('de','en'))
 *   .using (s => s)
 * [...all] //> [ [ 'de', '<b>Angelegt von:</b> ...' ], [ 'en', '<b>Created By:</b> ...' ] ]
 */
class Localize {

  constructor (input) {
    if (input) this.input = input
  }

  from (model) {
    this.model = model
    return this
  }

  for (...locales) {
    this.locales = Array.isArray(locales[0]) ? locales[0] : locales
    return this
  }

  with (bundle, overlay) {
    if (overlay) this.overlay = overlay
    this.bundle = bundle
    return this
  }

  using (replacer) {
    this.replacer = replacer
    return this
  }

  *[Symbol.iterator]() {
    const { input, bundle = i18n.bundle4(this.model), overlay={}, replacer=s=>s } = this
    const all = Object.entries (bundle.translations4?.(this.locales||'all') ?? bundle)
    const placeholders = /{i18n>([^}]+)}/g
    if (all.length) for (let [ lang, texts ] of all) yield [
      lang, input.replace (placeholders, (_,k) => overlay[k] || replacer(texts[k]) || k)
    ]
    else yield [ '', input ]
  }
}


// -----------------------------------------------------------------------------------------------
// Facade API

module.exports = exports = localize

function localize (input,...etc) {
  if (etc.length) return exports.legacy (input,...etc)
  return new Localize (input)
}

exports.edmx4 = service => new class extends Localize { get input(){
  const model = this.model || cds.model
  return super.input = cds.compile.to.edmx (model,{service})
}}

exports.edmx = edmx => {
  if (typeof edmx === 'object') edmx = cds.compile.to.edmx (edmx)
  const _xml_escapes = {
    '"'  : '&quot;',
    '<'  : '&lt;',
    '>'  : '&gt;',
    '&'  : '&amp;', // if not followed by amp; quot; lt; gt; apos; or #
    '\n' : '&#xa;',
    '\r' : '',
  }
  const _2b_escaped = /["<>\n\r]|&(?!quot;|amp;|lt;|gt;|apos;|#)/g
  const _xml_replacer = s => s?.replace (_2b_escaped, m => _xml_escapes[m])
  return localize (edmx) .using (_xml_replacer)
}

exports.json = json => {
  if (typeof json === 'object') json = JSON.stringify(json)
  const _json_replacer = s => s?.replace(/"/g, '\\"')
  return localize(json) .using (_json_replacer)
}



// -----------------------------------------------------------------------------------------------
// Legacy API, not used anymore in @sap/cds...

/** @deprecated */ exports.legacy = function (input, locales, model, ext) {

  // Support for legacy params signature with model as first argument, and edm string as third
  if (typeof input === 'object') [ input, model ] = [ model, input ]; if (!input) return
  if (typeof input !== 'string') input = JSON.stringify (input)
  if (locales == '*') locales = 'all' // NOTE: '*' is deprecated; using == to match '*' and ['*']

  // Construct fluent API instance from arguments
  const fluent = (
    input[0] === '<' ? exports.edmx (input) :
    input[0] === '{' ? exports.json (input) :
    localize (input)
  )
  if (locales) fluent.locales = locales
  if (model) fluent.model = model
  if (ext) fluent.overlay = ext

  // Return the first result if a single locale was requested, otherwise return all
  if (!Array.isArray(locales) && locales != 'all')
    for (let [,txt] of fluent) return txt
  else return function*(){
    for (let [lang,txt] of fluent) yield [ txt, {lang}]
  }()
}

/** @deprecated */ exports.bundles4 = function (model, locales = cds.env.i18n.languages) {
  const b = i18n.bundle4 (model)
  const all = b.translations4 (locales)
  return Object.entries (all)
}

/** @deprecated */ exports.bundle4 = function (model, locale) {
  if (typeof model === 'string') [ model, locale ] = [ cds.model, model ]
  const b = i18n.bundle4 (model)
  return b.texts4 (locale)
}

/** @deprecated */ exports.folders4 = function (model) {
  const b = i18n.bundle4 (model)
  return Object.keys (b.files)
}
