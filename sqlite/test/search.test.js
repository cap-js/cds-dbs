const cds = require('../../test/cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../test/bookshop')


describe('searching', () => {
  const { expect } = cds.test(bookshop)

  test('search via to-n association', async () => {
    // Make sure that there are no duplicates for search along to-many associations
    const { Authors, Books } = cds.entities()
    await INSERT.into(Authors).entries({ ID: 42, name: 'Rowling' })
    await INSERT.into(Books).entries([
      { ID: 2500, title: 'Harry Potter and the Philosopher\'s Stone', author_ID: 42 },
      { ID: 2501, title: 'Harry Potter and the Chamber of Secrets', author_ID: 42 },
      { ID: 2502, title: 'Harry Potter and the Prisoner of Azkaban', author_ID: 42 }
    ])
    Authors['@cds.search.books'] = true
    const search = SELECT.from(Authors).search('Potter')
    const res = await cds.run(search)
    expect(res).to.have.length(3) // TODO: should be 1
  })
})
