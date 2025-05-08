const cds = require('..')
const TRACE = cds.debug('trace')
if (TRACE) {
  TRACE?.time('require cds.compiler'.padEnd(22))
  require('@sap/cds-compiler/lib/compiler')
  TRACE?.timeEnd('require cds.compiler'.padEnd(22))
}

module.exports = exports = function load (files, options) {
  const any = cds.resolve(files,options)
  if (!any) return Promise.reject (new cds.error ({
    message: `Couldn't find a CDS model for '${files}' in ${cds.root}`,
    code: 'MODEL_NOT_FOUND', files,
  }))
  return this.get (any,options,'inferred')
}


exports.parsed = function cds_get (files, options, _flavor) {
  const o = typeof options === 'string' ? { flavor:options } : options || {}
  if (!files) files = ['*']; else if (!Array.isArray(files)) files = [files]
  if (o.files || o.flavor === 'files') return cds.resolve(files,o)
  if (o.sources || o.flavor === 'sources') return _sources4 (cds.resolve(files,o))
  if (!o.silent) TRACE?.time('cds.compile *.cds'.padEnd(22))

  const csn = cds.compile (files,o,
    o.parse  ? 'parsed' :
    o.plain  ? 'xtended' :
    o.clean  ? 'xtended' : // for compatibility
    o.flavor || _flavor || 'parsed'
  )
  return csn.then?.(_finalize) || _finalize(csn)
  function _finalize (csn) {
    if (!o.silent) cds.emit ('loaded', csn)
    if (!o.silent) TRACE?.timeEnd('cds.compile *.cds'.padEnd(22))
    return csn
  }
}

const _sources4 = async (files) => {
  const {path:{relative},fs:{promises:{readFile}}} = cds.utils, cwd = cds.root
  const sources = await Promise.all (files.map (f => readFile(f,'utf-8')))
  return files.reduce ((all,f,i) => { all[relative(cwd,f)] = sources[i]; return all },{})
}

exports.properties = (...args) => (exports.properties = require('./etc/properties').read) (...args)
exports.yaml = (file) => (exports.yaml = require('./etc/yaml').read) (file)
exports.csv = (file) => (exports.csv = require('./etc/csv').read) (file)
