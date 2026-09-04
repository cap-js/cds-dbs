const cds = require('../../test/cds')

// A to-many search path (SearchAuthors -> books.title / books.genre.name) makes one author
// fan out to many joined child rows; the ranking ORDER BY is a correlated MAX(SCORE(...))
// sub-select.
describe('search ranking', () => {
  const { expect } = cds.test(__dirname, 'search-ranking.cds')

  beforeAll(async () => {
    const { SearchAuthors, Books, Genres } = cds.entities('search.ranking')
    await cds.run([
      INSERT.into(Genres).entries([
        { ID: 1, name: 'Fantasy' },
        { ID: 2, name: 'Catalogue' },
        { ID: 3, name: 'History' },
      ]),
      INSERT.into(SearchAuthors).entries([
        { ID: 10, name: 'Strong' },
        { ID: 20, name: 'Weak' },
        { ID: 30, name: 'None' },
      ]),
      INSERT.into(Books).entries([
        // author 10: an exact title hit for 'Cat' plus an unrelated book -> should rank highest
        { ID: 100, title: 'Cat', author_ID: 10, genre_ID: 1 },
        { ID: 101, title: 'Unrelated', author_ID: 10, genre_ID: 1 },
        // author 20: only a partial/weaker hit via the genre name 'Catalogue'
        { ID: 200, title: 'Unrelated', author_ID: 20, genre_ID: 2 },
        // author 30: no match at all
        { ID: 300, title: 'Unrelated', author_ID: 30, genre_ID: 3 },
      ]),
    ])
  })

  test('deep to-many search ranks by best-matching child score, without duplicates', async () => {
    const { SearchAuthors } = cds.entities('search.ranking')
    const q = SELECT.from(SearchAuthors).columns('ID').search('Cat')

    // sanity: the injected order-by is the correlated MAX(SCORE(...)) sub-select
    const { sql } = cds.db.cqn2sql(q)
    expect(sql).to.match(/ORDER BY \(SELECT max\(SCORE\(/i)

    const res = await q

    // only the two matching authors come back, each exactly once (semi-join de-dups the fan-out)
    const ids = res.map(r => r.ID)
    expect(ids).to.have.members([10, 20])
    expect(ids.length).to.eq(2)

    // ranked by relevance desc: the exact title match (author 10) outranks the genre-only match (author 20)
    expect(ids[0]).to.eq(10)
    expect(ids[1]).to.eq(20)
  })

  test('user-provided order by takes precedence over the search rank', async () => {
    const { SearchAuthors } = cds.entities('search.ranking')
    // by name desc: 'Weak' (20) before 'Strong' (10) — the OPPOSITE of the relevance order,
    // so this only holds if user ordering wins and the rank is applied after it.
    const res = await SELECT.from(SearchAuthors).columns('ID').search('Cat').orderBy('name desc')
    expect(res.map(r => r.ID)).to.eql([20, 10])
  })

  test('opting out via hana.fuzzy.ranked_search = false skips the ranking', async () => {
    const _fuzzy = cds.env.hana.fuzzy
    cds.env.hana.fuzzy = { ranked_search: false }
    try {
      const { SearchAuthors } = cds.entities('search.ranking')
      const q = SELECT.from(SearchAuthors).columns('ID').search('Cat')

      // no ranking sub-select is injected ...
      const { sql } = cds.db.cqn2sql(q)
      expect(sql).to.not.match(/ORDER BY/i)

      // ... but the search itself still works (both matching authors returned)
      const ids = (await q).map(r => r.ID)
      expect(ids).to.have.members([10, 20])
    } finally {
      cds.env.hana.fuzzy = _fuzzy
    }
  })
})
