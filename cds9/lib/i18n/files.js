const cds = require('../index')
const LOG = cds.log('i18n')
const { path, fs } = cds.utils
const { existsSync: exists } = fs


/**
 * Instances of this class are used to fetch and read i18n resources from the file system.
 * The constructor fetches all i18n files from the existing i18n folders and adds them to
 * the instance in a files-by-folders fashion.
 * @example
 * new cds.i18n.Files
 * new cds.i18n.Files ({ roots: [ cds.home, cds.root+'/cap/sflight' ] })
 */
class I18nFiles {

  constructor (options) {

    // resolve options with defaults from cds.env.i18n config
    const {i18n} = cds.env, {
      file = i18n.file, basename = file,
      folders = i18n.folders,
      roots = [ i18n.root || cds.root, cds.home ],
      model = cds.model,
    } = options || i18n

    // prepare the things we need below...
    const files = this; this.#options = { roots, folders, basename }
    const base = RegExp(`${basename}[._]`)
    const _folders = I18nFiles.folders ??= {}
    const _entries = I18nFiles.entries ??= {}

    // fetch relatively specified i18n.folders in the neighborhood of sources...
    const relative_folders = folders.filter (f => f[0] !== '/')
    if (relative_folders.length) {
      const leafs = model?.$sources.map(path.dirname) ?? roots, visited = {}
      ;[...new Set(leafs)].reverse() .forEach (function _visit (dir) {
        if (dir in visited) return; else visited[dir] = true
        LOG.debug ('fetching', basename, 'bundles in', dir, relative_folders)
        // is there an i18n folder in the currently visited directory?
        for (const each of relative_folders) {
          const f = path.join(dir,each), _exists = _folders[f] ??= exists(f)
          if (_exists && _add_entries4(f)) return // stop at first match from i18n.folders
        }
        // else recurse up the folder hierarchy till reaching package roots ...
        if (leafs === roots || roots.includes(dir) || exists(path.join(dir,'package.json'))) return
        else _visit (path.dirname(dir))
      })
    }

    // fetch fully specified i18n.folders, i.e., those starting with /
    const specific_folders = folders.filter (f => f[0] === '/')
    for (const f of specific_folders) {
      const _exists = _folders[f] ??= exists(f)
      _add_entries4 (_exists ? f : path.join(cds.root,f))
    }

    // helper to add matching files from found folder, if any
    function _add_entries4 (f) {
      const matches = (_entries[f] ??= fs.readdirSync(f)) .filter (f => f.match(base))
      if (matches.length) return files[f] = matches
    }

    LOG.debug ('found', basename, 'bundles in these folders', Object.keys(files))
  }


  /**
   * Loads content from all files for the given locale.
   * @returns {entries[]} An array of entries, one for each file found.
   */
  content4 (locale, suffix = locale?.replace(/-/g,'_')) {
    const content = [], cached = I18nFiles[this.basename] ??= {}
    const _suffix = suffix ? '_'+ suffix : ''
    for (let dir in this) {
      const all = cached[dir] ??= this.load('.json',dir) || this.load('.csv',dir) || false
      if (all) { if (locale in all) content.push (all[locale]); continue }
      const props = this.load ('.properties', dir, _suffix)
      if (props) content.push (props)
    }
    return content
  }

  load (ext, dir, _suffix='') {
    const fn = `${this.basename}${_suffix}${ext}`; if (!this[dir].includes(fn)) return
    const file = path.join (dir, fn)
    try { switch (ext) {
      case '.properties': return _load_properties(file)
      case '.json': return _load_json(file)
      case '.csv': return _load_csv(file)
    }}
    finally { LOG.debug ('loading:', file) }
  }


  /**
   * Determines the locales for which translation files and content are available.
   * @returns {string[]}
   */
  locales() {
    return this.#locales ??= (()=>{
      const unique_locales = new Set()
      for (let [ folder, files ] of Object.entries(this)) {
        for (let file of files) {
          const { name, ext } = path.parse (file); switch (ext) {
            case '.properties': unique_locales.add(/(?:_(\w+))?$/.exec(name)?.[1]||''); break
            case '.json': for (let locale in _load_json(path.join(folder,file))) unique_locales.add(locale); break
            case '.csv': return _load_csv (path.join(folder,file))[0].slice(1)
          }
        }
      }
      return [...unique_locales]
    })()
  }

  #options
  #locales

  get basename(){ return this.#options.basename }
  get options(){ return this.#options }
}


const _load_properties = file => cds.load.properties(file, '.properties', { strings: true })
const _load_json = require
const _load_csv = file => {
  const csv = cds.load.csv(file); if (!csv) return
  const [ header, ...rows ] = csv, all = {}
  header.slice(1).forEach ((lang,i) => {
    const entries = all[lang] = {}
    for (let row of rows) if (row[i]) entries[row[0]] = row[i]
  })
  return all
}

module.exports = I18nFiles
