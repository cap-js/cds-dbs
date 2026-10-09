const cds = require('@sap/cds')
const { driver: HANADriver } = require('../lib/drivers/base')

// Regression test for the `hana_statements_cache: false` kill switch. The bug is pure
// JS wiring (independent of a real HANA), so it is exercised here with a mock native
// connection: with the cache disabled _prepare was rebound to a path that returned a
// statement without a .release(), while every prepare() call site does stmt.release()
// in finally -> "stmt.release is not a function" on the first query. No HANA needed.
describe('HANA statement cache kill switch (hana_statements_cache: false)', () => {
  let saved
  beforeAll(() => {
    cds.env.requires.db = cds.env.requires.db || {}
    saved = cds.env.requires.db.hana_statements_cache
    cds.env.requires.db.hana_statements_cache = false
  })
  afterAll(() => {
    cds.env.requires.db.hana_statements_cache = saved
  })

  // A driver whose native connection resolves prepare() to a statement that records
  // how often it is dropped. node-style callbacks match base.js's prom() wrapper.
  const newDriver = () => {
    const d = new HANADriver({})
    const stmt = { dropped: 0, exec: (_params, cb) => cb(null, []), drop: () => { stmt.dropped++ } }
    d._native = { prepare: (_sql, cb) => cb(null, stmt) }
    d.lastStmt = stmt
    return d
  }

  // Each of these threw before the fix because stmt.release was undefined.
  test.each(['run', 'get', 'all', 'runBatch'])('%s does not throw with the cache disabled', async method => {
    const d = newDriver()
    const prepared = await d.prepare('SELECT 1 FROM DUMMY')
    await prepared[method]([])
  })

  // all() calls release() twice (once before return, once in finally); the kill-switch
  // release must be idempotent so the statement is dropped exactly once, not double-dropped.
  test('release drops the uncached statement exactly once', async () => {
    const d = newDriver()
    const prepared = await d.prepare('SELECT 1 FROM DUMMY')
    await prepared.all([])
    expect(d.lastStmt.dropped).toBe(1)
  })
})
