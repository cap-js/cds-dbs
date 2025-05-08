const cds = require('..'), { path, isfile } = cds.utils
/**
 * NOTE: Need this typed helper variable to be able to use IntelliSense for calls with new keyword.
 * @import Service from './cds.Service'
 * @type new() => Service
 */
const factory = ServiceFactory
module.exports = exports = factory


function ServiceFactory (name, model, options) {

  const o = { ...options } // avoid changing shared options
  const def = model?.definitions[name] || {}
  const remote = o.external && (o.credentials || !o.mocked)

  return _use (remote ? o.impl : o.with || def['@impl'] || _sibling(def) || o.impl || _kind())
  async function _use (impl) { switch (typeof impl) {
    case 'function':
      if (impl._is_service_class) return new impl (name, model, o)
      return _use (_kind(), /*with:*/ o.impl = _legacy(impl) || impl)
    case 'object':
      return _use (impl[name] || impl.default || _kind())
    case 'string':
      if (impl.startsWith('@sap/cds/')) impl = cds.home + impl.slice(8)  //> for local tests in @sap/cds dev
      if (impl.startsWith('./')) impl = path.join (_source4(def) || 'x', '.'+impl)
      try { var resolved = require.resolve (path.join (cds.root, impl)) } catch (e) {       // fetch local paths
        try { resolved = require.resolve (impl, {paths:[ cds.root, cds.home ]}) } catch {  // fetch in node_modules
          throw cds.error(`Failed loading service implementation from ` + impl, { cause: e })
        }
      }
      impl = await cds.utils._import (resolved)
      impl = await _use (impl)
      impl._source = resolved
      return impl
    default: throw cds.error`Invalid service implementation for ${name}: ${impl}`
  }}

  function _kind (kind = o.kind ??= def['@kind'] || 'app-service') {
    const {impl} = cds.env.requires.kinds[kind] || cds.error `No configuration found for 'cds.requires.kinds.${kind}'`
    return impl || cds.error `No 'impl' configured for 'cds.requires.kinds.${kind}'`
  }
}


const exts = process.env.CDS_TYPESCRIPT ? ['.ts','.js','.mjs'] : ['.js','.mjs']
const _source4 = d => d['@source'] || d.$location?.file
const _sibling = d => {
  let file = _source4(d); if (!file) return
  let { dir, name } = path.parse (file); if (!dir) dir = '.'
  for (let subdir of ['/', '/lib/', '/handlers/']) {
    for (let ext of exts) try {
      const impl = dir + subdir + name + ext
      return isfile(impl) || require.resolve (impl, {paths:[ cds.root, cds.home ]})
    } catch(e) {
      if (e.code !== 'MODULE_NOT_FOUND') throw e
    }
  }
}
const _legacy = impl => { // legacy hello-world style class
  if (impl.prototype && /^class\b/.test(impl)) return function() {
    const legacy = new impl
    for (let k of Reflect.ownKeys(impl.prototype))
      k === 'constructor' || k === 'prototype' || this.on(k, legacy[k].bind(legacy))
  }
}


/**
 * Called by cds.connect() and cds.serve() for cds.service.impl-style implementations.
 * @protected
 */
exports.init = async function (srv) {
  const {impl} = srv.options; if (typeof impl === 'function' && !impl._is_service_class)
    await impl.call(srv, srv)
  await srv.init()
  return srv
}
