'use strict'

if (process.env.CDS_BENCH === 'true') {
  const cds = require('@sap/cds')
  const { writeDump } = require('./utils/format-benchmarks')
  
  let cqn4sql = require('../../lib/cqn4sql')
  
  const {
    perf,
  } = cds.test
  
  const report = (what, options) => perf.report(what, { store: true, stats: { requests: true }, ...options })
  
  describe('cqn4sql performance benchmarks', () => {
    beforeEach(async () => {
      const m = await cds.load([__dirname + '/model/schema']).then(cds.linked)
      const orig = cqn4sql // keep reference to original to avoid recursion
      cqn4sql = q => orig(q, m)
    })
  
    after('format & write dump', () => {
      writeDump({ testFile: __filename })
    })
  
    runBenchmarkFor('select simple', cds.ql`SELECT from my.Books { ID }`)
    
    runBenchmarkFor('select wildcard', cds.ql`SELECT from my.Books { * }`)
    runBenchmarkFor('select wildcard with calculated element', cds.ql`SELECT from my.BooksWithCalc { * }`)
  
    runBenchmarkFor('expand simple', cds.ql`SELECT from my.Authors { ID, books { title } }`)
    runBenchmarkFor('expand recursive (depth 3)', cds.ql`SELECT from my.Genres { ID, parent { parent { parent { name }}} }`)
  
    runBenchmarkFor('exists simple', cds.ql`SELECT from my.Genres { ID } where exists parent`)
    runBenchmarkFor('exists simple with path expression', cds.ql`SELECT from my.Genres { ID } where exists parent[parent.name = 'foo']`)
    runBenchmarkFor('exists recursive (depth 3)', cds.ql`SELECT from my.Genres { ID } where exists parent.parent.parent`)
  
    runBenchmarkFor('assoc2join simple', cds.ql`SELECT from my.Books { ID, author.firstName }`)
    runBenchmarkFor('assoc2join recursive (depth 3)', cds.ql`SELECT from my.Genres { ID, parent.parent.parent.name }`)
  
  })
  
  
  function runBenchmarkFor(name, cqn) {
    it(name, async () =>
      report(
        await perf.fn(
          () => {
            cqn4sql(cqn)
          },
          {
            title: name,
            warmup: {
              duration: '3s',
            },
            duration: '10s',
          },
        ),
      ),
    )
  }  
}
