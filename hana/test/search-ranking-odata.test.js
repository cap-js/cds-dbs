const cds = require('../../test/cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../test/bookshop')

const admin = { auth: { username: 'alice' } }

// $top makes the runtime add its implicit key ordering for stable pagination; the $search
// relevance rank must take precedence, with the key ordering only as a secondary criterion.
describe('search ranking via OData service', () => {
  const { expect, GET } = cds.test(bookshop)

  // 'Jane' hits the TITLE of "Jane Eyre" (ID 207) and only the DESCR of "Wuthering Heights"
  // (ID 201, "...sister Charlotte's novel Jane Eyre...")
  // Relevance ranks the title hit (207) first; the implicit key ordering (forced by $top) would put 201 first
  const search = () => GET('/admin/Books?$search=Jane&$top=5&$select=ID,title', admin)

  test('ranked search wins over the implicit key ordering', async () => {
    const ids = (await search()).data.value.map(b => b.ID)
    expect(ids.indexOf(207)).to.be.lessThan(ids.indexOf(201))
  })

  test('without ranking the implicit key ordering decides (same request)', async () => {
    const _fuzzy = cds.env.hana.fuzzy
    cds.env.hana.fuzzy = { ranked_search: false }
    try {
      const ids = (await search()).data.value.map(b => b.ID)
      // no rank -> only the implicit key ordering remains, so 201 comes before 207
      expect(ids.indexOf(201)).to.be.lessThan(ids.indexOf(207))
    } finally {
      cds.env.hana.fuzzy = _fuzzy
    }
  })
})
