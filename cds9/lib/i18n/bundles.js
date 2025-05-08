const cds = require('..'), {i18n} = cds.env
const I18nFiles = require ('./files')
const DEFAULTS = i18n.default_language
const FALLBACK = ''


class I18nBundle {

  constructor (options={}) {
    this.files = new I18nFiles (options)
    this.file = this.files.basename
    this.fallback = this.#translations[FALLBACK] = Object.assign ({}, ...this.files.content4(FALLBACK))
    this.defaults = this.#translations[DEFAULTS] = Object.assign (
      i18n.fatjson ? {...this.fallback} : {__proto__:this.fallback}, ...this.files.content4(DEFAULTS)
    )
  }

  #translations = {}

  /** Synonym for {@link at `this.at`} */
  get for() { return this.at }


  /**
   * Looks up the entry for the given key and locale.
   * - if `locale` is omitted, the current locale is used.
   * - if `args` are provided, fills in placeholders with them.
   * @example cds.i18n.labels.at ('CreatedAt','de')
   * @returns {string|undefined}
   */
  at (key, locale, args) {
    if (typeof locale !== 'string') [ args, locale ] = [ locale, cds.context?.locale ?? i18n.default_language ]
    if (typeof key === 'object') key = this.key4(key)
    let t = this.texts4 (locale) [key]
    if (t && args) t = t.replace (/{(\w+)}/g, (_,k) => args[k])
    return t
  }


  /**
   * Calls this.{@link at}() for all specified locales and returns an dictionary of results.
   * @example cds.i18n.labels.all('CreatedBy')
   */
  all (key, locales, args) {
    if (!key) return { ...this.translations() } // eslint-disable-line no-constant-binary-expression
    const all={}, translations = this.translations4 (locales)
    for (let locale in translations) {
      let t = translations[locale][key]
      if (t && args) t = t.replace (/{(\w+)}/g, (_,k) => args[k])
      all[locale] = t
    }
    return all
  }


  /**
   * Used by {@link at `this.at()`} to determine the i18n key for a given CSN definition.
   */
  key4 (d) {
    const anno = d['@Common.Label'] || d['@title'] || d['@UI.HeaderInfo.TypeName']
    if (anno) return /{i18n>([^}]+)}/.exec(anno)?.[1] || anno
    else return d.name || d.type // if any
  }


  /**
   * Returns translated texts for a specific locale.
   * @example cds.i18n.labels.texts4 ('de')
   */
  texts4 (locale='') {
    const $ = this.#translations;             if (locale in $) return $[locale]
    const suffix = locale.replace(/-/g,'_');  if (suffix in $) return $[locale] = $[suffix]
    const all = this.files.content4 (locale, suffix) // load content from all folders
    if (!all.length) { // nothing found, try w/o region, or return defaults
      const _ = suffix.indexOf('_')
      return $[locale] = $[suffix] = _ < 0 ? this.defaults : this.texts4 (suffix.slice(0,_))
    }
    const texts = i18n.fatjson ? {...this.defaults} : {__proto__:this.defaults}
    return $[locale] = $[suffix] = Object.assign (texts, ...all )
  }


  /**
   * Returns all translations for an array of locales or all locales.
   * @example { de, fr } = cds.i18n.labels.translations4 ('de','fr')
   * @param { 'all' | string[] } [locale]
   * @returns {{ [locale:string]: Record<string,string> }}
   */
  translations4 (...locales) {
    let first = locales[0] || cds.env.i18n.languages
    if (first == 'all') locales = this.files.locales()
    else if (Array.isArray(first)) locales = first
    return locales.reduce ((all,l) => (all[l] = this.texts4(l),all), {})
  }


  /**
   * Returns a proxy to lazily access all translations by locales as object properties.
   * @example { de, fr } = cds.i18n.labels.translations()
   */
  translations() {
    const b = this, files = b.files, pd = { configurable: true, enumerable: true }
    return new Proxy (this.#translations, {
      *[Symbol.iterator](){ for (let l of files.locales()) yield [ l, b.texts4(l) ]},
      ownKeys(){ return files.locales() }, getOwnPropertyDescriptor(){ return pd },
      has(t,p) { return files.locales().includes(p) },
      get(t,p) { return this[p] ?? b.texts4(p) },
    })
  }
}

module.exports = I18nBundle
