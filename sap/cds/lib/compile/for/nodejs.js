const { unfold_csn } = require ('../etc/_localized')
const cds = require ('../../index')
const TRACE = cds.debug('trace')


function _compile_for_nodejs (csn, o) {
  let min = cds.minify (csn)
  let dsn = cds.compile.for.odata(min, o) //> creates a partial copy -> avoid any cds.linked() before
  dsn = unfold_csn(dsn)
  dsn = cds.linked(dsn)
  cds.compile.for.lean_drafts(dsn, o)
  Object.defineProperty(csn, '_4nodejs', { value: dsn })
  Object.defineProperty(dsn, '_4nodejs', { value: dsn })
  Object.assign (dsn.meta, csn.meta, dsn.meta) // merge meta data, as it may have been enhanced
  return dsn
}


module.exports = function cds_compile_for_nodejs (csn,o) {
  if ('_4nodejs' in csn) return csn._4nodejs
  TRACE?.time('cds.compile 4nodejs'.padEnd(22)); try {
    let result, next = ()=> result ??= _compile_for_nodejs (csn,o)
    cds.emit ('compile.for.runtime', csn, o, next)
    return next() //> in case no handler called next
  }
  finally { TRACE?.timeEnd('cds.compile 4nodejs'.padEnd(22)) }
}
