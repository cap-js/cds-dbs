const cds = require('../../cds.js')
const bookshop = require('path').resolve(__dirname, '../../bookshop')

describe('Bookshop - Order By', () => {
  const { expect } = cds.test(bookshop)

    test('collations', async () => {
      // the original query is sorted by the **column** "ID"
      // the resulting query has two query sources in the end --> Authors and Books
      // even though both Tables have the element "ID", the DB should be able to resolve the
      // order by reference to the column unambiguously
      const query2 = SELECT.localized.from(`sap.capire.bookshop.Books`).columns(`ID`, `author.name`).orderBy(`ID`)
      const res = await query2
      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })

})
