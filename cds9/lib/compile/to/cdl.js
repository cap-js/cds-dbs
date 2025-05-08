const cdsc = require ('../cdsc')
const keywords = require("@sap/cds-compiler").to.cdl.keywords

function cds_compile_to_cdl (csn,o) {
  const results = cdsc.to.cdl (csn,o)
  const files = Object.keys(results)
  if (files.length === 1) return _cdl (results[files[0]])
  else return _many (results)
}

function* _many(all) {
  for (let file in all) yield [
    _cdl (all[file]),
    { file, suffix:'.cds' }
  ]
}

const _cdl = cdl => cdl.replace(/^\/\/ generated.+\n/,'')
module.exports = Object.assign(
  cds_compile_to_cdl,
  { keywords }
)