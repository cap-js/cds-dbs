const cds = require('../..')
const cdsc = require('../cdsc')
const TRACE = cds.debug('trace')

module.exports = (csn, o, beforeCsn) => {
  TRACE?.time('cds.compile 2hana'.padEnd(22))
  try {
    let result, next = ()=> result ??= function* (){
      csn = cds.minify (csn)
      const { definitions, deletions, migrations, afterImage } = cdsc.to.hdi.migration (csn, o,
        typeof beforeCsn === 'string' ? beforeCsn = JSON.parse(beforeCsn) : beforeCsn
      )
      for (const { name, suffix, sql } of definitions) {
        yield [sql, { file: name + suffix }]
      }
      if (deletions.length > 0) {
        yield [deletions, { file: 'deletions.json' }]
      }
      if (migrations.length > 0) {
        yield [migrations, { file: 'migrations.json' }]
      }
      let needsAfterImage = beforeCsn || Object.values(afterImage.definitions).some(def => def['@cds.persistence.journal'])
      if (needsAfterImage) {
        yield [afterImage, { file: 'afterImage.json' }]
      }
    }()
    cds.emit ('compile.to.dbx', csn, o, next)
    return next() //> in case no handler called next
  }
  finally { TRACE?.timeEnd('cds.compile 2hana'.padEnd(22)) }
}
