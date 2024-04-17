const cds = require('../../cds.js')
const bookshop = require('path').resolve(__dirname, '../../bookshop')

describe('Bookshop - Search', () => {
  const { expect } = cds.test(bookshop)

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

      let res = await SELECT.from(Books).columns('author.name as author', 'title').search('1 Main Street, Bradford')
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

      let res = await SELECT.from(Books).columns('author.name as author', 'title').search('1 Main Street, Bradford')
      // author name in res[0] must match "Emily Brontë"
      expect(res.length).to.be.eq(1)
      expect(res[0].author).to.be.eq('Emily Brontë')
    })
  })
})
