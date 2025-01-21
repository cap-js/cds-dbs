const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

describe('Bookshop - assertions', () => {
  const { expect } = cds.test(bookshop)
  let cats, Books

  before('bootstrap the database', async () => {
    Books = cds.entities.Books
    cats = await cds.connect.to('CatalogService')
    await INSERT({ ID: 42, title: 'Harry Potter and the Chamber of Secrets', stock: 15 }).into(Books)
  })

  describe('UPDATE', () => {
    test('simple assertion', async () => {
      // await expect(UPDATE(Books, '42').with({ stock: -1 })).to.be.rejectedWith(/The stock must be greater than 0/)
      await UPDATE(Books, '42').with({ stock: -1 })
      // stock for harry potter should still be 15
      const book = await SELECT.one.from(Books).where({ ID: 42 })
      expect(book.stock).to.equal(15)
    })

    test('assertion via action', async () => {
      // try to withdraw more books than there are in stock
      await cats.tx({ user: 'alice' }, async () => {
        await expect(cats.send('submitOrder', { book: 42, quantity: 16 })).to.be.rejectedWith(
          /The stock must be greater than 0 after withdrawal/,
        )
      })

      // stock for harry potter should still be 15
      const book = await SELECT.one.from(Books).where({ ID: 42 })
      expect(book.stock).to.equal(15)
    })
  })

  describe('INSERT', () => {
    test('simple assertion, no negative stocks', async () => {
      await INSERT({ ID: 43, title: 'Harry Potter and Prisoner of Azkaban', stock: -1 }).into(Books)
      // book should not have been inserted
      const book = await SELECT.one.from(Books).where({ ID: 43 })
      expect(book).to.be.undefined
    })

    test('assertion in batch', async () => {
      await INSERT.into(Books).entries([
        { ID: 44, title: 'Harry Potter and the Goblet of Fire', stock: 10 },
        { ID: 45, title: 'Harry Potter and the Order of the Phoenix', stock: -1 },
      ])
      // both books should not have been inserted
      const books = await SELECT.from(Books).where({ ID: { in: [44, 45] } })
      expect(books).to.have.length(0)
    })
  })
})
