const { resolve, join, sep } = require('path')
const { readdirSync } = require('fs')
const suffixes = [ '.csn', '.cds', sep+'index.csn', sep+'index.cds', sep+'csn.json' ]


/**
* Resolves given model references to an array of absolute filenames.
* For the model references, all these are accepted:
* - with suffix or without → will append `.csn|cds`, `/index.csn|cds`
* - absolute refs like `@sap/cds/common`
* - local refs with leading `.` or without, e.g. `srv/cat-service`
* - directory names → will fetch all contained `.csn` and `.cds` files
* - arrays of any of the above
* @returns and array of absolute filenames
*/
module.exports = exports = function cds_resolve (model, o={}) { // NOSONAR
  if (!model || model === '--') return
  if (model._resolved) return model
  if (model === '*') return _resolve_all(o,this)
  if (Array.isArray(model)) {
    const resolved = [... new Set(model)] .reduce ((prev,next) => prev.concat (this.resolve(next,o)||[]), [])
    return o.dry || o === false ? [...new Set(resolved.flat())] : _resolved (resolved)
  }
  if (model.endsWith('/*')) return _resolve_subdirs_in(model,o,this)

  const cwd = o.root || this.root, local = resolve (cwd,model)
  const context = _paths(cwd,o,this), {cached} = context
  let id = model.startsWith('.') ? local : model
  if (id in cached)  return cached[id]

  // expand @sap/cds by cds.home
  if (id.startsWith('@sap/cds/')) id = this.home + id.slice(8)

  // fetch file with .cds/.csn suffix as is
  if (/\.(csn|cds)$/.test(id)) try {
    return cached[id] = _resolved ([ _resolve (id,context) ])
  } catch {/* ignored */}

  // try to resolve file with one of the suffixes
  for (let tail of o.suffixes || suffixes) try {
    return cached[id] = _resolved ([ _resolve (id+tail,context) ])
  } catch {/* ignored */}

  // fetch all in a directory
  if (o.all !== false) try {
    const files = readdirSync(local), all=[], unique={}
    for (let f of files) if (f.endsWith('.csn')) {
      all.push (unique[f.slice(0,-4)] = join(local,f))
    }
    for (let f of files) if (f.endsWith('.cds')) {
      unique[f.slice(0,-4)] || all.push (join(local,f))
    }
    return cached[id] = _resolved (all)
  } catch {/* ignored */}

  // fetch file without suffix
  if (o.any !== false && !id.endsWith('/')) try { // NOTE: this also finds .js files!
    return cached[id] = _resolved ([ _resolve (id,context) ])
  } catch {/* ignored */}

}


exports.cache = {}


const _required = (cds,env=cds.env) => Object.values(env.requires) .map (r => r.model) .filter(x=>x)
const _resolve = require('module')._resolveFilename

function _resolve_all (o,cds) {
  const {roots} = o.env || cds.env; if (o.dry || o === false)  return [ ...roots, ...new Set(_required(cds).flat()) ]
  const cache = o.cache || exports.cache
  const cached = cache['*']; if (cached) return cached
  cache['*'] = [] // important to avoid endless recursion on '*'
  const sources = cds.resolve (roots,o) || []
  if (!(sources.length === 1 && sources[0].endsWith('csn.json'))) // REVISIT: why is that? -> pre-compiled gen/csn.json?
    sources.push (...cds.resolve (_required(cds,o.env),o)||[])
  return cache['*'] = _resolved (sources)
}

function _resolve_subdirs_in (pattern='fts/*',o,cds) {
  const cache = o.cache || exports.cache
  const cached = cache[pattern]; if (cached && !o.dry && o !== false)  return cached
  const folder = pattern.slice(0,-2), dir = resolve (o.root || cds.root, folder)
  try {
    const dirs = readdirSync(dir) .filter (e => cds.utils.isdir(dir+sep+e)) .map (e => folder+sep+e+sep)
    if (o.dry || o === false)  return dirs
    return cache[pattern] = cds.resolve (dirs,o) || undefined
  } catch(e) {
    if (e.code === 'ENOENT')
    return cache[pattern] = undefined
  }
}

function _paths (dir,o,cds) {
  const cache = o.cache || exports.cache
  const cached = cache[dir]; if (cached)  return cached
  const a = dir.split(sep), n = a.length, paths = [ dir ]
  const { cdsc: { moduleLookupDirectories }} = o.env ?? cds.env
  for (const mld of moduleLookupDirectories) { // node_modules/ usually, more for Java
    paths.push(...a.map ((_,i,a)=> a.slice(0,n-i).join(sep)+sep+mld))
  }
  return cache[dir] = { paths, cached:{} }
}

function _resolved (array) {
  if (!array || !array.length)  return
  return Object.defineProperty ([...new Set (array)], '_resolved', {value:true})
}
