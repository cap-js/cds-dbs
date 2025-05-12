const cwd = process.env._original_cwd || process.cwd()
const cds = require('../index')

/* eslint no-empty: ["error", { "allowEmptyCatch": true }] */
// eslint-disable-next-line no-unused-vars
const _tarLib = () => { try { return require('tar') } catch(_) {} }

exports = module.exports = new class {
  get colors() { return super.colors = require('./colors') }
  get inflect() { return super.inflect = require('./inflect') }
  get inspect() {
    const options = { depth: 11, colors: this.colors.enabled }
    const {inspect} = require('node:util')
    return super.inspect = v => inspect(v,options)
  }
  get format() {
    const {format} = require('node:util')
    return super.format = format
  }
  get uuid() { return super.uuid = require('crypto').randomUUID }
  get yaml() { const yaml = require('js-yaml'); return super.yaml = Object.assign(yaml,{parse:yaml.load}) }
  get tar()  { return super.tar = process.platform === 'win32' && _tarLib() ? require('./tar-lib') : require('./tar') }
}

/** @type {import('node:path')} */
const path = exports.path = require('path'), { dirname, join, resolve, relative } = path

/** @type {import('node:fs')} */
const fs = exports.fs = Object.assign (exports,require('fs')) //> for compatibility


/**
 * Variant of `Object.keys()` which includes all keys inherited from the
 * given object's prototypes.
 */
exports.Object_keys = o => ({
  [Symbol.iterator]: function*(){ for (let k in o) yield k },
  forEach(f){ let i=0; for (let k in o) f(k,i++,o) },
  filter(f){ let i=0, r=[]; for (let k in o) f(k,i++,o) && r.push(k); return r },
  map(f){ let i=0, r=[]; for (let k in o) r.push(f(k,i++,o)); return r },
  some(f){ for (let k in o) if (f(k)) return true },
  find(f){ for (let k in o) if (f(k)) return k },
})


/**
 * Simple helper to always access results as arrays.
 */
exports.results = oa => {
  return Array.isArray(oa) ? oa : oa != null ? [oa] : []
}


/**
 * Simple helper to deep-merge two or more objects.
 * Entries from `xs` overwrite entries in `o`.
 * @example cds.utils.merge({foo:1},{bar:2},{baz:3})
 * @returns `o` with entries from `xs` merged in.
 */
exports.merge = function merge (o,...xs) {
  let v; for (let x of xs) for (let k in x)
    if (k === '__proto__' || k === 'constructor') continue //> avoid prototype pollution
    else o[k] = is_object(v=x[k]) ? merge(o[k]??={},v) : v
  return o
}
const is_object = x => typeof x === 'object' && x !== null && !is_array(x)
const is_array = Array.isArray


/**
 * Should be used in data providers, i.e., db services to return single
 * rows in response to SELECT.one queries.
 */
exports.chimera = oa => {
  return Array.isArray(oa) ? oa : Object.defineProperties(oa,chimera)
}
const chimera = Object.getOwnPropertyDescriptors (class Chimera {
  *[Symbol.iterator] (){ yield this }
  forEach(f){ f(this,0,this) }
  filter(f){ return f(this,0,this) ? [this] : [] }
  map(f){ return [f(this,0,this)] }
  some(f){ return f(this,0,this) }
  find(f){ if (f(this,0,this)) return this }
}.prototype)


exports.decodeURIComponent = s => { try { return decodeURIComponent(s) } catch { return s } }
exports.decodeURI = s => { try { return decodeURI(s) } catch { return s } }

exports.local = (file) => file && relative(cwd,file)

const { prepareStackTrace, stackTraceLimit } = Error

/**
 * Use this utility to get a stack trace from the current position in the code.
 * For example, try this in your code, or in cds repl:
 *
 *     cds.utils.stack(22) .forEach (each => console.log (
 *       each.getTypeName()||'<anonymous>',
 *       each.getMethodName()||'—',
 *       each.getFunctionName(),
 *       '(' + cds.utils.local (each.getFileName())
 *        + ':' + each.getLineNumber()
 *        + ':' + each.getColumnNumber()
 *        + ')'
 *     ))
 *
 * **WARNING:** This is an **expensive** function → handle with care!
 * @param {number} [depth] - the number of stack frames to return (default: 11)
 * @returns {NodeJS.CallSite[]} - an array of CallSite objects, as returned by [`Error.prepareStackTrace`](https://v8.dev/docs/stack-trace-api)
 */
exports.stack = (depth=11) => {
  Error.prepareStackTrace = (_,stack) => stack
  Error.stackTraceLimit = depth
  const stack = (new Error).stack
  Error.stackTraceLimit = stackTraceLimit
  Error.prepareStackTrace = prepareStackTrace
  return stack
}

/**
 * Use this utility to get the location of the caller in the code.
 * For example:
 *
 *     let [file,line,col] = cds.utils.location()
 *
 * Basically a shortcut for `cds.utils.stack(3)[2]`,
 * with filename, line number, and column number returned in an array.
 *
 * **WARNING:** This is an **expensive** function → handle with care!
 * @returns {[ filename:string, line:number, column:number ]}
 */
exports.location = function() {
  const l = this.stack(3)[2]
  return [ l.getFileName(), l.getLineNumber(), l.getColumnNumber() ]
}


exports.exists = function(x) {
  if (x) {
    const y = resolve (cds.root,x)
    return fs.existsSync(y)
  }
}

// REVISIT naming: doesn't return boolean
exports.isdir = function isdir (...args) {
  if (args.length) try {
    const y = resolve (cds.root,...args)
    const ls = fs.lstatSync(y)
    if (ls.isDirectory()) return y
    if (ls.isSymbolicLink()) return isdir (join (dirname(y), fs.readlinkSync(y)))
  } catch {/* ignore */}
}

// REVISIT naming: doesn't return boolean
exports.isfile = function isfile (...args) {
  if (args.length) try {
    const y = resolve (cds.root,...args)
    const ls = fs.lstatSync(y)
    if (ls.isFile()) return y
    if (ls.isSymbolicLink()) return isfile (join (dirname(y), fs.readlinkSync(y)))
  } catch {/* ignore */}
}

exports.stat = async function (x) {
  const d = resolve (cds.root,x)
  return fs.promises.stat(d)
}

exports.readdir = async function (x) {
  const d = resolve (cds.root,x)
  return fs.promises.readdir(d)
}

exports.read = async function read (file, _encoding) {
  const f = resolve (cds.root,file)
  const src = await fs.promises.readFile (f, _encoding !== 'json' && _encoding || 'utf8')
  if (_encoding === 'json' || !_encoding && f.endsWith('.json')) try {
    return JSON.parse(src)
  } catch(e) {
    throw new Error (`Failed to parse JSON in ${f}: ${e.message}`)
  }
  else return src
}

exports.write = function write (file, data, o) {
  if (arguments.length === 1) return {to:(...path) => write(join(...path),file)}
  if (typeof data === 'object' && !Buffer.isBuffer(data)) {
    let indent = o?.spaces || file.match(/(package|.cdsrc).json$/) && 2
    data = JSON.stringify(data, null, indent) + '\n'
  }
  const f = resolve (cds.root,file)
  return exports.mkdirp (dirname(f)).then (()=> fs.promises.writeFile (f,data,o))
}

exports.append = function append (file, data, o) {
  if (arguments.length === 1) return {to:(...path) => append(join(...path), data)}
  const f = resolve (cds.root,file)
  return exports.mkdirp (dirname(f)).then (()=> fs.promises.writeFile (f,data,o))
}

exports.copy = function copy (x,y) {
  if (arguments.length === 1) return {to:(...path) => copy(x,join(...path))}
  const src = resolve (cds.root,x)
  const dst = resolve (cds.root,y)
  return fs.promises.cp (src,dst,{recursive:true})
}

exports.mkdirp = async function (...path) {
  const d = resolve (cds.root,...path)
  await fs.promises.mkdir (d,{recursive:true})
  return d
}

exports.rmdir = async function (...path) {
  const d = resolve (cds.root,...path)
  await fs.promises.rm (d, {recursive:true})
  return d
}

exports.rimraf = async function (...path) {
  const d = resolve (cds.root,...path)
  await fs.promises.rm (d, {recursive:true,force:true})
  return d
}

exports.rm = async function rm (x) {
  const y = resolve (cds.root,x)
  await fs.promises.rm(y)
  return y
}

exports.find = function find (base, patterns='*', filter=()=>true) {
  const files=[];  base = resolve (cds.root,base)
  if (typeof patterns === 'string')  patterns = patterns.split(',')
  if (typeof filter === 'string')  filter = this[filter]
  patterns.forEach (pattern => {
    const star = pattern.indexOf('*')
    if (star >= 0) {
      const head = pattern.slice(0,star).replace(/[^/\\]*$/,'')
      const dir = join (base,head)
      try {
        const ls = fs.lstatSync(dir)
        if (ls.isDirectory()) {
          const [,suffix,tail] = /([^/\\]*)?(?:.(.*))?/.exec (pattern.slice(star+1))
          const prefix = pattern.slice(head.length,star)
          let entries = fs.readdirSync(dir) //.filter (_filter)
          if (prefix)  entries = entries.filter (e => e.startsWith(prefix));  if (!entries.length) return
          if (suffix)  entries = entries.filter (e => e.endsWith(suffix));  if (!entries.length) return
          let paths = entries.map (e=>join(dir,e))
          if (filter)  paths = paths.filter (filter);  if (!paths.length) return
          if (tail)  for (let _files of paths.map (e=>find (e,tail,filter)))  files.push (..._files)
          else  files.push (...paths)
        }
      } catch {/* ignore */}
    } else {
      const file = join (base, pattern)
      if (fs.existsSync(file))  files.push (file)
    }
  })
  return files
}


exports.deprecated = (fn, { kind = 'Method', old = fn.name+'()', use } = {}) => {
  const yellow = '\x1b[33m'
  const reset = '\x1b[0m'
  // use cds.log in production for custom logger
  const {warn} = cds.env.production ? cds.log() : console
  if (typeof fn !== 'function') {
    if (cds.env.features.deprecated === 'off') return
    [kind,old,use] = [fn.kind || 'Configuration',fn.old,fn.use]
    warn (
      yellow,
      '\n------------------------------------------------------------------------------',
      '\nDEPRECATED:', old, '\n',
      '\n  ', (kind ? `${kind} ${old}` : old), 'is deprecated and will be removed in upcoming releases!',
      use ? `\n   => Please use ${use} instead.` : '', '\n',
      '\n------------------------------------------------------------------------------\n',
      reset
    )
  } else return function() {
    if (cds.env.features.deprecated !== 'off' && !fn.warned) {
      let o={}; Error.captureStackTrace(o)
      warn (
        yellow,
        '\n------------------------------------------------------------------------------',
        '\nDEPRECATED:', old, '\n',
        '\n  ', (kind ? `${kind} ${old}` : old), 'is deprecated and will be removed in upcoming releases!',
        use ? `\n   => Please use ${use} instead.` : '', '\n',
        o.stack.replace(/^Error:?\s*at.*\n/m,'\n'), '\n',
        '\n------------------------------------------------------------------------------\n',
        reset
      )
      if (cds.env.features.deprecated !== 'show all') fn.warned = true
    }
    return fn.apply (this, arguments)
  }
}

exports.csv = require('./csv-reader')

/**
 * Loads a file through ESM or CommonJs.
 * @returns { Promise<any> }
 */
// TODO find a better place.
exports._import = id => {
  try {
    return require(id) // try CommonJS first
  } catch (err) {
    if (err.code !== 'ERR_REQUIRE_ESM')  throw err
    // else try w/ ESM
    const { pathToFileURL } = require('url')
    return import (pathToFileURL(id).href) // must use a file: URL, esp. on Windows for C:\... paths
  }
}

const SECRETS = /(passw)|(cert)|(ca)|(secret)|(key)/i
/**
 * Masks password-like strings, also reducing clutter in output
 * @param {any} cred - object or array with credentials
 * @returns {any}
 */
exports.redacted = function _redacted(cred) {
  if (!cred) return cred
  if (Array.isArray(cred)) return cred.map(c => typeof c === 'string' ? '...' : _redacted(c))
  if (typeof cred === 'object') {
    const newCred = Object.assign({}, cred)
    Object.keys(newCred).forEach(k => (typeof newCred[k] === 'string' && SECRETS.test(k)) ? (newCred[k] = '...') : (newCred[k] = _redacted(newCred[k])))
    return newCred
  }
  return cred
}
