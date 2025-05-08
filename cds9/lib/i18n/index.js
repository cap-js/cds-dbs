const I18nBundle = require ('./bundles')
const I18nFiles = require ('./files')
const cds = require('../index')

class I18nFacade {

  Facade = I18nFacade
  Bundle = I18nBundle
  Files = I18nFiles

  /** Shortcuts to config options */
  get folders() { return cds.env.i18n.folders }
  get file() { return cds.env.i18n.file }

  /**
   * The default bundle for runtime messages.
   */
  get messages() {
    // ensure we always find our factory defaults as fallback
    const factory_defaults = cds.utils.path.resolve (__dirname,'../../_i18n')
    const folders = [ ...cds.env.i18n.folders, factory_defaults ]
    return super.messages = this.bundle4 ('messages', { folders })
  }


  /**
   * The default bundle for UI labels and texts.
   */
  get labels() {
    return super.labels = this.bundle4 (cds.model)
  }

  /**
   * Lazily constructs, caches and returns a bundle for the given subject.
   * @param {string|object} [file] - a CSN model, or a string used as the bundle's basename
   * @param {object} [options] - additional options to pass to the bundle constructor
   * @returns {I18nBundle}
   */
  bundle4 (file, options) {
    if (_is_string(file)) return super[file] ??= new I18nBundle ({ basename: file, ...options })
    if (_is_model(file))  return _cached(file).texts ??= new I18nBundle ({ model: file })
    else                  return new I18nBundle (options = file)
  }


  // -----------------------------------------------------------------------------------------------
  // following are convenience methods, rather useful in cds repl

  files4 (options) {
    if (typeof options === 'string') options = { roots: [ cds.home, cds.utils.path.resolve(cds.root,options) ] }
    return new I18nFiles (options)
  }

  folders4 (options) {
    return Object.keys (this.files4(options))
  }
}

const _cached = m => m._cached ??= Object.defineProperty (m,'_cached',{writable:true}) && {}
const _is_model = x => typeof x === 'object' && '$sources' in x
const _is_string = x => typeof x === 'string'

module.exports = exports = new I18nFacade
exports.locale = require('./locale')
