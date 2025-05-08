// The only entry point to produce CSNs consumed by the Java Runtime

const cds = require ('../../index')
const TRACE = cds.debug('trace')

function _4java (csn,o) {
  const compile = require ('../cdsc');
  o = compile._options.for.odata(o); // get compiler options, see compile.for.odata
  return (compile.for.java ?? _4java_tmp) (csn,o);
}

function _4java_tmp (csn,o) { // as long as compile.for.java is not definitely there
  const _4draft = require ('@sap/cds-compiler/lib/transform/draft/odata');
  const dsn = JSON.parse (JSON.stringify (csn)) // REVISIT: workaround for bad test setup
  if (o.tenantDiscriminator) {
    const { addTenantFields } = require ('@sap/cds-compiler/lib/transform/addTenantFields');
    addTenantFields (dsn, o);
  }
  return _4draft (dsn, o);
}

function _compile_for_java (csn,o) {
  const dsn = (!cds.env.features._ucsn_) ? cds.compile.for.odata (csn,o||{}) : _4java (csn,o||{});
  if (dsn.definitions) for (let [name,d] of Object.entries(dsn.definitions)) {
    // Add @cds.external to external services
    if (d.kind === 'service' && name in cds.requires) d['@cds.external'] = true
    // Add parsed ._where clause to @restrict annotations
    const rr = d['@restrict']
    if (rr) for (let r of rr) if (r.grant && r.where) try {
      r._where = JSON.stringify (cds.parse.xpr(r.where))
    } catch {/* ignored */}
  }
  Object.defineProperty (csn, '_4java', {value:dsn})
  Object.defineProperty (dsn, '_4java', {value:dsn})
  return dsn
}


module.exports = function cds_compile_for_java (csn,o) {
  if ('_4java' in csn) return csn._4java
  TRACE?.time('cds.compile 4java'.padEnd(22))
  try {
    // csn = cds.minify (csn)
    let result, next = ()=> result ??= _compile_for_java (csn,o)
    cds.emit ('compile.for.runtime', csn, o, next)
    return next() //> in case no handler called next
  }
  finally { TRACE?.timeEnd('cds.compile 4java'.padEnd(22)) }
}
