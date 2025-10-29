const cds = require('../../test/cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../test/bookshop')

const admin = {
  auth: {
    username: 'alice',
  },
}

describe('searching', () => {
  const { expect, GET } = cds.test(bookshop)

  test('search via to-n association', async () => {
    // Make sure that there are no duplicates for search along to-many associations
    const { Authors, Books } = cds.entities('sap.capire.bookshop')
    await INSERT.into(Authors).entries({ ID: 42, name: 'Rowling' })
    await INSERT.into(Books).entries([
      { ID: 2500, title: "Harry Potter and the Philosopher's Stone", author_ID: 42 },
      { ID: 2501, title: 'Harry Potter and the Chamber of Secrets', author_ID: 42 },
      { ID: 2502, title: 'Harry Potter and the Prisoner of Azkaban', author_ID: 42 },
    ])
    Authors['@cds.search.books'] = true
    const search = SELECT.from(Authors).search('Potter')
    const res = await cds.run(search)
    expect(res).to.have.length(1)
  })

  // Skipping $search tests as the github action HANA version does not support SCORE
  test('Search book', async () => {
    const res = await GET('/admin/Books?$search=cat', admin)
    expect(res.status).to.be.eq(200)
    expect(res.data.value.length).to.be.eq(1)
    expect(res.data.value[0].title).to.be.eq('Catweazle')
  })

  test('Search book with space and quotes', async () => {
    const res = await GET('/admin/Books?$search="e R"', admin)
    expect(res.status).to.be.eq(200)
    expect(res.data.value.length).to.be.eq(2)
    expect(res.data.value[0].title).to.be.eq('The Raven')
    expect(res.data.value[1].descr).to.include('e r')
  })

  test('Search book with filter', async () => {
    const res = await GET('/admin/Books?$search="e R"&$filter=ID eq 251 or ID eq 271', admin)
    expect(res.status).to.be.eq(200)
    expect(res.data.value.length).to.be.eq(2)
    expect(res.data.value[0].title).to.be.eq('The Raven')
    expect(res.data.value[1].descr).to.include('e r')
    expect(res.data.value[0].ID).to.be.eq(251)
    expect(res.data.value[1].ID).to.be.eq(271)
  })

  // search expression operating on aggregated results, must be put into the having clause
  describe('with aggregate function', () => {
    test('min', async () => {
      const { Books } = cds.entities
      let res = await SELECT.from(Books)
        .columns({ args: [{ ref: ['title'] }], as: 'firstInAlphabet', func: 'MIN' })
        .groupBy('title')
        .search('Cat')
      expect(res.length).to.be.eq(1)
    })
  })
  describe('with path expressions', () => {
    // reset search terms and cache before each test
    beforeEach(async () => {
      const { Books, Authors } = cds.entities

      resetSearchTerms(Books)
      resetSearchTerms(Authors)

      function resetSearchTerms(entity) {
        delete entity.__searchableColumns
        Object.keys(entity).forEach(key => {
          if (key.startsWith('@cds.search')) {
            delete entity[key]
          }
        })
      }
    })

    test('Search authors via books', async () => {
      const { Books } = cds.entities
      // ad-hoc search expression
      Books['@cds.search.author'] = true

      let res = await SELECT.from(Books).columns('author.name', 'title').search('Brontë')
      expect(res.length).to.be.eq(2) // Emily and Charlotte
    })

    test('Search authors address through calculated element in books', async () => {
      const { Books } = cds.entities
      // ad-hoc search expression
      Books['@cds.search.authorsAddress'] = true

      let res = await SELECT.from(Books).columns('author.name as author', 'title').search('"1 Main Street, Bradford"')
      // author name in res[0] must match "Emily Brontë"
      expect(res.length).to.be.eq(1)
      expect(res[0].author).to.be.eq('Emily Brontë')
    })
    test('Search authors calculated element via books', async () => {
      const { Books } = cds.entities
      const { Authors } = cds.entities
      // ad-hoc search expression
      Books['@cds.search.author'] = true
      Authors['@cds.search.address'] = true // address is a calculated element

      let res = await SELECT.from(Books).columns('author.name as author', 'title').search('"1 Main Street, Bradford"')
      // author name in res[0] must match "Emily Brontë"
      expect(res.length).to.be.eq(1)
      expect(res[0].author).to.be.eq('Emily Brontë')
    })

    test('Search escaped character in search literal', async () => {
      const { Books } = cds.entities
      const { Authors } = cds.entities
      // ad-hoc search expression
      Books['@cds.search.author'] = true
      Authors['@cds.search.address'] = true // address is a calculated element

      let res = await SELECT.from(Books).columns('author.name as author', 'title').search('"\\"\\\\"')
      expect(res.length).to.be.eq(0)
    })

    test('Search improperly escaped character in search literal', async () => {
      const { Books } = cds.entities
      const { Authors } = cds.entities
      // ad-hoc search expression
      Books['@cds.search.author'] = true
      Authors['@cds.search.address'] = true // address is a calculated element

      let res = await SELECT.from(Books).columns('author.name as author', 'title').search('"\\q"')
      expect(res.length).to.be.eq(0)
    })

    test('search on result of subselect', async () => {
      const res = await cds.run(
        SELECT.from(SELECT.from({ ref: ['sap.capire.bookshop.Books'] }).columns('title'))
          .columns('title')
          .search('Wuthering'),
      )
      expect(res.length).to.be.eq(1)
    })
    test('search on result of subselect via path expression', async () => {
      const query = SELECT.from(SELECT.from({ ref: ['sap.capire.bookshop.Books'] }).columns('title', 'author'))
        .columns('title', 'author')
        .search('Brontë')
      query.SELECT.from['@cds.search.author'] = true
      const res = await cds.run(query)
      expect(res.length).to.be.eq(2)
    })

    test('search also own columns if association is part of `@cds.search`', async () => {
      const { Books } = cds.entities
      // ad-hoc search expression
      Books['@cds.search.author'] = true

      // matches the title
      let res = await SELECT.from(Books).columns('author.name', 'title').search('Wuthering')
      expect(res.length).to.be.eq(1)
      expect(res[0].title).to.be.eq('Wuthering Heights')

      res = await SELECT.from(Books).columns('author.name', 'title').search('Emily')
      expect(res.length).to.be.eq(1)
      expect(res[0].title).to.be.eq('Wuthering Heights')
    })
  })
})
