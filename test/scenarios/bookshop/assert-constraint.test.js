const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

describe('Bookshop - assertions', () => {
  const { expect } = cds.test(bookshop)
  let cats, Books

  before('bootstrap the database', async () => {
    Books = cds.entities.Books
    await INSERT({ ID: 42, title: 'Harry Potter and the Chamber of Secrets', stock: 15, price: 15 }).into(Books)
  })

  describe('UPDATE', () => {
    test('simple assertion', async () => {
      await UPDATE(Books, '42').with({ stock: -1 })
      // stock for harry potter should still be 15
      const book = await SELECT.one.from(Books).where({ ID: 42 })
      expect(book.stock).to.equal(15)
    })

    test('assertion via action', async () => {
      cats = await cds.connect.to('CatalogService')
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

    test('assertion via aggregation', async () => {
      await INSERT({ ID: 46, title: 'Harry Potter and the Half-Blood Prince', stock: 10 }).into(Books)
      const book = await SELECT.one.from(Books).where({ ID: 46 }) // no problem if no price provided
      expect(book.stock).to.equal(10)
      // Insert very expensive book
      await INSERT({ ID: 47, title: 'Harry Potter and the Deathly Hallows', stock: 10, price: 1000 }).into(Books)
      // book should not have been inserted
      const book2 = await SELECT.one.from(Books).where({ ID: 47 })
      expect(book2).to.be.undefined
    })

    test('no stock is okay', async () => {
      await INSERT({ ID: 48, title: 'Harry Potter and the Cursed Child', stock: null }).into(Books)

      const book = await SELECT.one.from(Books).where({ ID: 48 })
      expect(book).to.exist

    })
  })
})
