const compile = require ('../cdsc')
const cds = require('../../index')
const TRACE = cds.debug('trace')

module.exports = function cds_compile_for_odata (csn,_o) {
  if ('_4odata' in csn) return csn._4odata
  TRACE?.time('cds.compile 4odata'.padEnd(22))
  let o = compile._options.for.odata(_o) //> required to inspect .sql_mapping below
  let dsn = compile.for.odata (csn,o)
  if (o.sql_mapping) dsn['@sql_mapping'] = o.sql_mapping //> compat4 old Java stack
  Object.defineProperty (csn, '_4odata', {value:dsn})
  Object.defineProperty (dsn, '_4odata', {value:dsn})
  TRACE?.timeEnd('cds.compile 4odata'.padEnd(22))
  return dsn
}
