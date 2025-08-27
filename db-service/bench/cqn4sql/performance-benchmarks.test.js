'use strict'

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

  runBenchmarkFor('expand simple', cds.ql`SELECT from my.Authors { ID, books { title } }`)
  runBenchmarkFor('expand recursive (depth 3)', cds.ql`SELECT from my.Genres { ID, parent { parent { parent { name }}} }`)

  runBenchmarkFor('exists simple', cds.ql`SELECT from my.Genres { ID, parent { parent { parent { name }}} }`)
  runBenchmarkFor('exists recursive (depth 3)', cds.ql`SELECT from my.Genres { ID } where exists parent.parent.parent`)

  runBenchmarkFor('assoc2join simple', cds.ql`SELECT from my.Books { ID, author.name }`)
  runBenchmarkFor('assoc2join recursive (depth 3)', cds.ql`SELECT from my.Genres { ID, parent.parent.parent.name }`)

})


function runBenchmarkFor(name, cqn) {
  it(name, async () => report(await perf.fn(() => {
    cqn4sql(cqn)
  }, { title: name })))
}
