const { isdir, isfile, fs, path } = require('../utils/cds-utils')
const DEFAULTS = require('./defaults'), defaults = require.resolve ('./defaults')
const compat = require('./compat')
const DEBUG = /\b(y|all|env)\b/.test(process.env.DEBUG) ? console.debug : undefined


/**
 * Both a config instance as well as factory for.
 */
class Config {

  /**
   * This is the one and only way to construct new instances.
   * Public API is through `cds.env.for (<context>)`
   * @returns {Config & typeof DEFAULTS}
   */
  for (context, cwd = this._home || global.cds?.root || process.cwd(), _defaults=true) {
    DEBUG?.('[cds.env] - loading config for', {context,cwd})
    return new Config (context, cwd, _defaults)
  }

  /**
   * Only used internally, i.e. through cds.env.for(<context>)
   */
  constructor (_context, _home, _defaults=true) {
    Object.assign (this, { _context, _home, _sources:[] })

    // Capture stack trace to report cds.env usage before cds.test()
    if (global.test) Error.captureStackTrace(this,Config.prototype.for)

    // Determine profiles from NODE_ENV + CDS_ENV
    const { NODE_ENV, CDS_ENV } = process.env, profiles = []
    if (NODE_ENV) profiles.push (NODE_ENV)
    if (CDS_ENV) profiles.push (...CDS_ENV.split(/\s*,\s*/))
    if (_home) _add_static_profiles (_home, profiles);
    if (_home && this['project-nature'] === 'java') profiles.push('java')
    if (!profiles.includes('production')) profiles.push('development')
    this._profiles = new Set (profiles)
    this._profiles._defined = new Set
    this._profiles._important = []

    // Set compat requires default values
    if (_context === 'cds' && _defaults)  this.add (DEFAULTS, defaults)
    if (_context === 'cds' && _defaults)  compat (this)
    if (!_home)  return

    // Read config sources in reverse order of precedence -> last one wins
    if (_context !== 'cds') {
      this.#import (_home,'package.json', { get: p => p[_context] })
    } else {
      for (let {impl} of Object.values(this.plugins)) {
        const _plugin = path.dirname(impl)
        this.#import (_plugin,'.cdsrc.yaml', { load: _readYaml })
        this.#import (_plugin,'.cdsrc.json')
        this.#import (_plugin,'.cdsrc.js')
        this.#import (_plugin,'package.json', { get: p => p.cds })
      }
      const user_ = process.env.CDS_USER_HOME || require('os').homedir()
      this.#import (user_,'.cdsrc.json')
      this.#import (user_,'.cdsrc.js')
      this.#import (_home,'.cdsrc.yaml', { load: _readYaml })
      this.#import (_home,'.cdsrc.json')
      this.#import (_home,'.cdsrc.js')
      this.#import (_home,'package.json', { get: _ext_package_json })
      this.#import (_home,'.cdsrc-private.json')
    }

    // Apply important (!) profiles from config sources
    for (let each of this._profiles._important) each()
    delete this._profiles._important

    // Add process env before linking to allow things like CDS_requires_db=sql
    this._add_process_env()

    // Link cds.requires services to cds.requires.kinds
    this._link_required_services()

    // Add compatibility and correlations for mtx
    const db  = this.requires?.db
    if (this.requires?.db) {
      if (this.requires.multitenancy !== undefined)
        Object.defineProperty (db, 'multiTenant', { value: !!this.requires.multitenancy })
      else if (db.multiTenant !== undefined)
        this.requires.multitenancy = db.multiTenant
    }
    if (this.requires?.multitenancy && this.requires.db?.kind === 'hana' && !this.requires.db.vcap) Object.assign(this.requires.db, { vcap: { label: 'service-manager' } })

    // Complete service configurations from cloud service bindings
    this._add_cloud_service_bindings(process.env)

    // Only if feature is enabled
    if (this.features && this.features.emulate_vcap_services) {
      this._emulate_vcap_services()
    }
  }


  #import (dir, file, etc) {
    let conf = this.load (dir, file, etc)
    if (conf) this.add (conf)
  }


  load (dir, file, { load=_readJson, get = x => x.cds||x } = {}) {
    file = path.join (dir, file)
    DEBUG?.('[cds.env] - checking', {file})
    let cont = load(file); if (!cont) return
    let conf = get(cont); if (!conf) return
    DEBUG?.('[cds.env] - importing', file)
    this._sources.push (file)
    return conf
  }


  get plugins() {
    return super.plugins = require('../plugins').fetch()
  }


  add (conf, /*from:*/ _src, profiles = this._profiles) {
    if (!conf)  return this
    if (_src)  this._sources.push (_src)
    const reqs = conf.requires
    if (reqs) { // normalize requires.x = kind to requires.x = {kind}
      for (let each in reqs) {
        if (typeof reqs[each] === 'string') reqs[each] = {kind:conf.requires[each]}
      }
    }
    _merge (this, conf, profiles)
    return this
  }

  /**
   * Retrieves the value for a config option, specified as a property path.
   */
  get (option) {
    if (!option) return
    let path = option.includes('/') ? option.split('/') : option.split('.')
    return path.reduce ((p,n)=> p && p[n], this)
  }

  get profiles() {
    return super.profiles = Array.from (this._profiles)
  }

  get roots() {
    return super.roots = Object.values(this.folders) .concat ([ 'schema', 'services' ])
  }

  get tmp() { return super.tmp = require('os').tmpdir() }

  /**
   * Provides access to system defaults for cds env.
   */
  get defaults() { return DEFAULTS }

  /**
   * Get effective options for .odata
   */
  get effective(){
    return super.effective = require('..').compiler._options.for.env()
  }

  /**
   * For BAS only: to find out whether this is a Java or Node.js project
   */
  get "project-nature" () {
    const has_pom_xml = [this.folders?.srv,'.'] .some (
      f => f && isfile (path.join (this._home, f, 'pom.xml'))
    )
    return has_pom_xml ? 'java' : 'nodejs'
  }

  /**
   * For BAS only: get all defined profiles (could include some from the defaults)
   */
  get "defined-profiles" () {
    return [...this._profiles._defined]
  }


  //////////////////////////////////////////////////////////////////////////
  //
  //    DANGER ZONE!
  //    The following are internal APIs which can always change!
  //

  _add_to_env (filename, env = process.env) {
    const _env = this.load (this._home, filename, { load: _readEnv })
    for (const key in _env) {
      if (key in env) continue // do not change existing env vars
      const val = _env[key]
      env[key] = typeof val === 'string' ? val : JSON.stringify(val)
    }
  }

  _add_process_env() {
    const prefix = this._context, cwd = this._home
    const {env} = process
    this._add_to_env ('default-env.json', env)
    if (this._profiles.has('development')) {
      for (let each of this._profiles)
        each === 'development' || this._add_to_env (`.${each}.env`, env)
      this._add_to_env ('.env', env)
    }

    const PREF = prefix.toUpperCase(), my = { CONFIG: PREF+'_CONFIG', ENV: PREF+'_ENV' }
    let config

    let val = env[my.CONFIG]
    if (val) try {
      // CDS_CONFIG={ /* json */}
      config = JSON.parse (val)
    } catch {
      // CDS_CONFIG=/path/to/config.json *OR* CDS_CONFIG=/path/to/config/dir
      if (typeof val === "string") {
        // Load from JSON file or directory; No profile support!
        if (cwd && !path.isAbsolute(val)) val = path.join(cwd, val)
        const json = _readJson(val) || _readFromDir(val)
        if (json) this.add (json, val, false)
      }
    }

    if (!config) config = {}
    const pref_ = RegExp('^'+prefix+'[._]','i')
    for (let p in env) if (!(p in my) && pref_.test(p)) {
      const pEsc = p.replace(/__/g, '!!') // escaping of _ by __ :  protect __ so that it's not split below
      const key = /[a-z]/.test(pEsc) ? pEsc : pEsc.toLowerCase() //> CDS_FOO_BAR -> cds_foo_bar
      let path = key.slice(prefix.length+1) .split (key[prefix.length]) //> ['foo','bar']
      for (var o=config,next;;) {
        next = path.shift()
        next = next.replace(/!!/g, '_')  // undo !! protection and reduce __ to _
        if (!path.length) break
        if (!path[0]) next = next+'-'+path.shift()+path.shift() // foo__bar -> foo-bar
        o = o[next] || (o[next] = {})
      }
      o[next] = _value4(env[p])
    }

    if (Object.keys(config).length)  this.add (config, 'process.env')
  }

  _link_required_services () {
    const { requires, _profiles } = this; if (!requires) return
    const kinds = requires.kinds || {}
    Object.defineProperty (requires, 'kinds', { value:kinds, enumerable:false }) // for cds env
    // Object.setPrototypeOf (requires, kinds)
    for (let each in kinds)  kinds[each] = _linked (each, kinds[each])
    for (let each in requires) requires[each] = _linked (each, requires[each])
    function _linked (key, val) {
      if (!val || val._is_linked) return val
      if (val === true) {
        let x = kinds[key]
        if (x) val = x; else if (key+'-defaults' in kinds) val = {kind:key+'-defaults'}; else return val
      }
      if (typeof val === 'string') {
        let x = kinds[val] || kinds[val+'-'+key] || kinds[key+'-'+val]
        if (x) val = {kind:val}; else return val
      }
      let k = val.kind, p, preset = kinds[p=k] || kinds[p=k+'-'+key] || kinds[p=key+'-'+k]
      if (!preset?.$root) {
        const preset1 = kinds[key]
        if (typeof preset1 === 'object' && preset1 !== val) {
          const top = val, base = _merge ({},_linked(key,preset1)), {kind} = base
          val = _merge (base, top)    // apply/override with top-level data
          if (kind) val.kind = kind  // but inherited kind wins
        }
      }
      if (typeof preset === 'object' && preset !== val) {
        const top = val, base = _merge ({},_linked(p,preset), _profiles), {kind} = base
        val = _merge (base, top, _profiles)  // apply/override with top-level data
        if (kind) val.kind = kind           // but inherited kind wins
      }
      if (typeof val === 'object') Object.defineProperty (val, '_is_linked', {value:true})
      return val
    }
  }

  _add_vcap_services (VCAP_SERVICES) {
    if (this.features && this.features.vcaps === false)  return
    if (!this.requires)  return
    if (!VCAP_SERVICES) return
    try {
      const vcaps = JSON.parse (VCAP_SERVICES)
      const any = this._add_vcap_services_to (vcaps)
      if (any)  this._sources.push ('process.env.VCAP_SERVICES')
    } catch(e) {
      throw new Error ('[cds.env] - failed to parse VCAP_SERVICES:\n  '+ e.message)
    }
  }

  _add_cloud_service_bindings({ VCAP_SERVICES, SERVICE_BINDING_ROOT }) {
    let bindings, bindingsSource

    if (!this.requires)  return
    if (VCAP_SERVICES && !(this.features && this.features.vcaps == false)) {
      try {
        bindings = JSON.parse(VCAP_SERVICES)
        bindingsSource = 'process.env.VCAP_SERVICES'
      } catch(e) {
        throw new Error ('[cds.env] - failed to parse VCAP_SERVICES:\n  '+ e.message)
      }
    }

    if (!bindings && SERVICE_BINDING_ROOT) {
      bindings = require('./serviceBindings')(SERVICE_BINDING_ROOT)
      bindingsSource = SERVICE_BINDING_ROOT
    }

    if (bindings) {
      try {
        const any = this._add_vcap_services_to(bindings)
        if (any)  this._sources.push(bindingsSource)
      } catch(e) {
        throw new Error(`[cds.env] - failed to add service bindings from ${bindingsSource}:\n ${e.message}`);
      }
    }
  }

  /**
   * Build VCAP_SERVICES for compatibility (for example for CloudSDK) or for running
   * locally with credentials (hybrid mode).
   */
  _emulate_vcap_services() {
    const vcap_services = {}, names = new Set()
    for (const service in this.requires) {
      let { vcap, credentials, binding } = this.requires[service]
      // "binding.vcap" is chosen over "vcap" because it is meta data resolved from the real service (-> cds bind)
      if (binding && binding.vcap) vcap = binding.vcap
      if (vcap && vcap.label && credentials && Object.keys(credentials).length > 0) {
        // Only one entry for a (instance) name. Generate name from label and plan if not given.
        const { label, plan } = vcap
        const name = vcap.name || `instance:${label}:${plan || ""}`
        if (names.has(name)) continue
        names.add(name)

        if (!vcap_services[label]) vcap_services[label] = []
        vcap_services[label].push(Object.assign({ name }, vcap, { credentials }))
      }
    }
    process.env.VCAP_SERVICES = JSON.stringify(vcap_services)
  }


//////////////////////////////////////////////////////////////////////////
//
//    FORBIDDEN ZONE!
//    The following are hacks for tests which should not exist!
//    Tests should test public APIs, not internal ones.
//    Tests should even less intrude hacks to core components
//


  // FOR TESTS ONLY! --> PLEASE: tests should test public APIs (only)
  _for_tests (...conf) {
    const env = new Config('cds')
    this._for_tests.vcaps = (vcaps) => { env._add_vcap_services_to (vcaps)}
    // merge all configs, then resolve profiles (same as in 'for' function above)
    for (let c of [...conf].reverse())  _merge(env, c, env._profiles)
    return env
  }
  // FOR TESTS ONLY! --> PLEASE: tests should test public APIs (only)
  _merge_with (src) {
    _merge (this, src, this._profiles)
    return this
  }

  // API for binding resolution in @sap/cds-dk
  _find_credentials_for_required_service(service, conf, vcaps) {
    return conf.vcap && _fetch (conf.vcap) ||  //> alternatives, e.g. { name:'foo', tag:'foo' }
      _fetch ({ name: service })  ||
      _fetch ({ tag: this._context+':'+service }) ||
      _fetch ({ tag: conf.dialect || conf.kind }) || // important for hanatrial, labeled 'hanatrial', tagged 'hana'
      _fetch ({ label: conf.dialect || conf.kind }) ||
      _fetch ({ type: conf.dialect || conf.kind })

    function _fetch (predicate) {
      const filters = []
      for (let k in predicate) {
        const v = predicate[k]; if (!v) continue
        const filter = k === 'tag' ? e => _array(e,'tags').includes(v) : e => e[k] === v
        filters.push(filter)
      }
      if (filters.length === 0)  return false
      for (let stype in vcaps) {
        const found = _array(vcaps,stype).find(e => filters.every(f => f(e)))
        if (found)  return found
      }
    }

    function _array(o,p) {
      const v = o[p]
      if (!v) return []
      if (Array.isArray(v)) return v
      throw new Error(`Expected VCAP entry '${p}' to be an array, but was: ${require('util').inspect(vcaps)}`)
    }
  }

  _add_vcap_services_to (vcaps={}) {
    let any
    for (let service in this.requires) {
      const conf = this.requires [service]
      if (!conf) continue
      const { credentials } = this._find_credentials_for_required_service(service, conf, vcaps) || {}
      if (credentials)  {
        // Merge `credentials`.  Needed because some app-defined things like `credentials.destination` must survive.
        any = conf.credentials = Object.assign ({}, conf.credentials, credentials)
      }
    }
    return !!any
  }
}


//////////////////////////////////////////////////////////////////////////
//
//    Local Helpers...
//

/**
 * Allows to set profiles in package.json or .cdsrc.json like so:
 * ```json
 * { "cds": { "profiles": ["mtx-sidecar","java"] } }
 * { "cds": { "profile": "mtx-sidecar" } }
 * ```
 */
function _add_static_profiles (_home, profiles) {
  for (let src of ['package.json', '.cdsrc.json']) try {
  const conf = require(path.join(_home,src))
    const cds = src === 'package.json' ? conf.cds : conf.cds||conf
    if (cds?.profiles) return profiles.push(...cds.profiles)
    if (cds?.profile) return profiles.push(cds.profile)
  } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e }
}

/**
 * @returns {Config} dst
 */
function _merge (dst, src, _profiles) {
  const profiled = [], descr = Object.getOwnPropertyDescriptors(src)
  for (let p in descr) {
    const pd = descr[p]

    if ('get' in pd || !pd.enumerable) {
      Object.defineProperty(dst,p,pd)
      continue
    }

    if (_profiles && p[0] === '[') {
      const important = p.endsWith('!]')
      const profile = p.slice (1, important ? -2 : -1)
      if (_profiles._defined) _profiles._defined.add (profile)
      if (_profiles.has(profile)) {
        let o = src[p]; if (typeof o !== 'object') continue
        let merge = () => _merge (dst, o, _profiles, false)
        if (important && _profiles._important) _profiles._important.push(merge)
        else profiled.push ({ profile, merge })
      }
      continue
    }

    const v = pd.value
    if (typeof v === 'object' && !Array.isArray(v) && v != null) {
      if (!dst[p]) dst[p] = {}
      if (typeof dst[p] !== 'object') dst[p] = v
      else _merge (dst[p], v, _profiles)
      continue
    }
    else if (typeof v === 'string' && typeof dst[p] === 'object' && dst[p]?.kind) {
      dst[p].kind = v  // requires.db = 'foo' -> requires.db.kind = 'foo'
    }
    else if (v !== undefined) dst[p] = v
  }
  if (profiled.length > 0 && !_profiles.has('production')) {
    const profiles = Array.from(_profiles)
    profiled.sort((a,b) => profiles.indexOf(b.profile) - profiles.indexOf(a.profile))
  }
  for (let each of profiled) each.merge()
  return dst
}

function _value4 (val) {
  if (val && val[0] === '{') try { return JSON.parse(val) } catch {/* ignored */}
  if (val && val[0] === '[') try { return JSON.parse(val) } catch {/* ignored */}
  if (val === 'true')  return true
  if (val === 'false')  return false
  if (!isNaN(val))  return parseFloat(val)
  return val
}

function _readJson (file) {
  if (isfile(file)) {
    if (file.endsWith('.js')) return require (file)
    try { return JSON.parse (fs.readFileSync(file,'utf-8')) } catch (e) { console.error(e) }
  }
}

function _readYaml (file) {
  if (isfile(file)) {
    const YAML = _readYaml.parser ??= require('js-yaml')
    return YAML.load (fs.readFileSync(file,'utf-8'))
  }
}

function _readEnv (file) {
  if (isfile(file)) {
    const ENV = _readEnv.parser = require('../compile/etc/properties')
    return ENV.parse (fs.readFileSync(file,'utf-8'))
  }
}

function _readFromDir (p) {
  if (isdir(p)) {
    const result = {}
    for (const dirent of fs.readdirSync(p)) result[dirent] = _readFromDir(path.join(p, dirent))
    return result
  }
  return _value4(fs.readFileSync(p, "utf-8"))
}

// REVISIT: We need to get rid of such hard-coded stuff
function _ext_package_json (pkg) { // fill cds.extends from .extends
  let cds = pkg.cds
  if (pkg.extends) (cds??={}).extends = pkg.extends
  return cds
}


/** @type Config & typeof DEFAULTS */
module.exports = Config.prototype
/* eslint no-console:0 */
