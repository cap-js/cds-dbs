/** REVISIT: Use `@sap/cds-compiler` if for_sql is made public. */
const compile = require ('@sap/cds-compiler/lib/api/main')
let _compile

module.exports = function cds_compile_for_sql (src,o) {
  _compile = _compile || compile.for_sql
  // for_sql directly returns a CSN
  return _compile(src,{...o,csn:true});
}
