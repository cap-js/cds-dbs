// Disable the prepared-statement cache. Must be set before @sap/cds resolves its env
// (cds.env.requires.db isn't populated until the HANA test config loads), so use the
// cds env-var convention: `__` escapes the underscores inside `hana_statements_cache`.
process.env.cds_requires_db_hana__statements__cache = 'false'

const cds = require('../../test/cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../test/bookshop')

// Regression test for the `cds.requires.db.hana_statements_cache: false` kill switch.
// Before the fix, disabling the cache made `_prepare` return a native statement without a
// `release()` method, so every prepared-statement query threw
// `TypeError: stmt.release is not a function`. With the cache off, a fresh statement is
// prepared per execution and dropped on release — repeated runs must still succeed.
describe('HANA statement cache disabled', () => {
  const { expect } = cds.test(bookshop)

  test('flag is actually off', () => {
    expect(cds.env.requires.db.hana_statements_cache).to.equal(false)
  })

  test('parameterized query re-prepares instead of reusing a cached statement', async () => {
    // Run the SAME parameterized CQN query twice on one connection. CQN with a value takes
    // onSELECT's prepared-statement path (prepare().all()) — the path the cache applies to,
    // and where the missing release() previously crashed.
    const q = () => SELECT.from('sap.capire.bookshop.Books').where('ID =', 201)

    await cds.db.tx(async tx => {
      const res1 = await tx.run(q())
      expect(res1.length).to.be.eq(1)

      const res2 = await tx.run(q())
      expect(res2.length).to.be.eq(1)

      // The driver keeps reusable prepared statements in `dbc.statements`, keyed by SQL.
      // With the cache disabled it must never populate that map: each execution prepares a
      // fresh statement and drops it on release. An empty map proves the 2nd (identical)
      // query did NOT reuse a cached statement — the whole point of hana_statements_cache:false.
      // (With caching on, this map would contain the query's SQL after the first run.)
      expect(tx.dbc, 'tx should hold a driver connection').to.exist
      expect(Object.keys(tx.dbc.statements), 'no statement may be cached').to.have.length(0)
    })
  })
})
