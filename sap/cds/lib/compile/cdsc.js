const cds = require ('../index')
const compile = require ('@sap/cds-compiler')
const _4cdsc = Symbol('_4cdsc')

/**
 * Returns a copy of the given options object, with all mappings applied and
 * finally overridden with entries from cds.env.cdsc. That is, the equivalent
 * of {...o, ...[...mappings], ...cds.env.cdsc }.
 * @type <T> (src:T,...mappings:{}[]) => T
 */
function _options4 (src, ...mappings) {
  if (src[_4cdsc]) return src //> already prepared for cdsc
  // Create a derivate of given src options object
  const dst = Object.defineProperty({__proto__:src, ...src}, _4cdsc,{value:true}) // NOTE: {__proto__:src} alone doesn't suffice, due to compiler obviously cloning options; {...src} doesn't suffice as non-enumerables from .effective.odata would get lost
  // Apply mappings in order of appearance -> latter ones override formers
  for (let map of mappings) for (let k in map) {
    let v = dst[k];  if (v === undefined) continue
    let m = map[k];  if (typeof m === 'function') m(dst,v); else dst[m] = v
  }
  // Optionally add .messages array to avoid compiler writing messages to stderr
  dst.messages = dst.messages || []
  // Finally override with options from cds.env.cdsc
  return Object.assign(dst,cds.env.cdsc)
}


/**
 * Decorates the _options4 function with individual options mapping functions
 * for use in respective calls to cdsc functions. Can be used as follows:
 *
 *     const {_options} = require(<this module>)   // from external
 *     _options.for.odata({...})                   // same in here
 */
const _options = {for: Object.assign (_options4, {

  odata(o,_more) {
    const odata = cds.env.odata
    if (o && o[_4cdsc]) return o
    let f = o && o.flavor || odata.flavor || o, flavor = odata.flavors && odata.flavors[f] || {}
    let v = o && o.version || flavor.version || odata.version   //> env.odata.flavors.version overrides env.odata.version!
    let o2 = { ...flavor, ...odata, ...o, version:v }
    if (o2.refs && o2.proxies === undefined) o2.proxies = true  //> o.proxies follows o.refs
    o2.names = this.sql().names
    return _options4 (o2, {
      version     : 'odataVersion',
      structs     : (o,v) => o.odataFormat = v ? 'structured' : 'flat',
      refs        : (o,v) => o.odataForeignKeys = !v,
      xrefs       : 'odataXServiceRefs',
      proxies     : 'odataProxies',
      containment : 'odataContainment',
      // IMPORTANT: as a matter of fact we need the below not only for .to.sql tasks
      sql_mapping  : 'names', //> legacy
      names        : (o,v) => v !== 'plain' ? o.sqlMapping = v : undefined,
    }, _more)
  },

  edm(o) {
    return this.odata (o, {
      version : 'odataVersion',
      service : 'service',
    })
  },

  sql (_o, _env, _conf = cds.requires.db) {
    // REVISIT: compiler requires to only provide assertIntegrityType if defined
    if (_o?._4sql) return _o
    const o = _options4 ({ ..._env||cds.env.sql, ..._o, _4sql: true }, {
      sql_mapping  : 'names', //> legacy
      sqlDialect   : 'dialect', //> legacy
      sqlMapping   : 'names',
      dialect      : 'sqlDialect',
      names        : (o,v) => v !== 'plain' ? o.sqlMapping = v : undefined,
    })

    if (!o.sqlDialect) {
      let conf = _conf || cds.requires.kinds.sql
      let dialect = conf.dialect || conf.kind
      if (dialect) o.sqlDialect = dialect
    }

    const _using_legacy_db = (()=>{
      if (_conf?.impl) return _conf.impl.includes('@sap/cds/libx/_runtime/')
      if (cds.requires.kinds.sqlite.impl === '@cap-js/sqlite') return false
      else try { return require('sqlite3', { paths:[cds.root] }) } catch {/* ignore */}
    })()
    if (_using_legacy_db) {
      o.betterSqliteSessionVariables = false
      o.fewerLocalizedViews = false
    }

    const { native_hana_associations, transitive_localized_views } = cds.env.sql
    if (native_hana_associations !== undefined)
      o.withHanaAssociations = native_hana_associations
    if (transitive_localized_views !== undefined)
      o.fewerLocalizedViews = !transitive_localized_views

    const { assert_integrity } = cds.env.features
    if (assert_integrity)
      o.assertIntegrityType = assert_integrity.toString().toUpperCase()

    return o
  },

  hana(o) {
    let cdsc = this.sql (o, cds.env.hana, cds.requires.kinds.hana) // returns clone
    cdsc.sqlChangeMode ??= cdsc.journal && cdsc.journal['change-mode']
    cdsc.disableHanaComments ??= !cdsc.comments
    delete cdsc.journal // cleanup avoiding side effects
    delete cdsc.comments
    return cdsc
  },

  env() {
    const odata = this.edm()
    const sql   = this.sql()
    const hana  = this.hana()
    const env = {
      odata: odata.__proto__,
      sql:   sql.__proto__,
      hana:  hana.__proto__,
      cdsc: { ...odata, ...sql, ...hana }
    }
    delete env.odata.flavors
    return env
  },

})}


/**
 * Return a derivate of cdsc, with the most prominent
 * @type { import('@sap/cds-compiler') }
 */
module.exports = exports = {__proto__:compile, _options,
  for: {__proto__: compile.for,
    odata: (csn,o) => compile.for.odata  (csn, _options.for.odata(o)),
  },
  to: {__proto__: compile.to,
    edmx: Object.assign ((csn,o) => compile.to.edmx (csn, _options.for.edm(o)), {
      all: (csn,o) => compile.to.edmx.all (csn, _options.for.edm(o))
    }),
    edm: Object.assign ((csn,o) => compile.to.edm (csn, _options.for.edm(o)), {
      all: (csn,o) => compile.to.edm.all (csn, _options.for.edm(o))
    }),
    hdi: Object.assign ((csn,o) => compile.to.hdi (csn, _options.for.hana(o)),
      compile.to.hdi, // keywords
      {
        migration: (csn,o,...etc) => {
          o = Object.assign ({...o},_options.for.hana(o)) //> REVISIT: need to flatten as compiler seems to clone options in that impl
          return compile.to.hdi.migration (csn, o, ...etc)
        }
      },
    ),
    hdbcds: Object.assign(
      (csn,o) => compile.to.hdbcds (csn, _options.for.hana(o)),
      compile.to.hdbcds // keywords
    ),
    sql: Object.assign(
      (csn,o) => compile.to.sql (csn, _options.for.sql(o)),
      compile.to.sql // smart* functions
    ),
    deltaSql: (csn, o, beforeCsn) => compile.to.sql.migration(csn, o, beforeCsn), // or like hdi.migration
    cdl: Object.assign(
      (csn,o) => compile.to.cdl (csn, _options4(o||{})),
      compile.to.cdl // smart* functions
    ),
  },
}
