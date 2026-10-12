const cds = require('@sap/cds')
const { driver: HANADriver } = require('../lib/drivers/base')

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

  const newDriver = () => {
    const d = new HANADriver({})
    const stmt = { dropped: 0, exec: (_params, cb) => cb(null, []), drop: () => { stmt.dropped++ } }
    d._native = { prepare: (_sql, cb) => cb(null, stmt) }
    d.lastStmt = stmt
    return d
  }

  test.each(['run', 'get', 'all', 'runBatch'])('%s does not throw with the cache disabled', async method => {
    const d = newDriver()
    const prepared = await d.prepare('SELECT 1 FROM DUMMY')
    await prepared[method]([])
  })

  test('release drops the uncached statement exactly once', async () => {
    const d = newDriver()
    const prepared = await d.prepare('SELECT 1 FROM DUMMY')
    await prepared.all([])
    expect(d.lastStmt.dropped).toBe(1)
  })
})
