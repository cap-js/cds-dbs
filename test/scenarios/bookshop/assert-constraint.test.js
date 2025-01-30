const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

describe('Bookshop - assertions', () => {
  const { expect } = cds.test(bookshop)
  let adminService,catService, Books

  before('bootstrap the database', async () => {
    Books = cds.entities.Books
    await INSERT({ ID: 42, title: 'Harry Potter and the Chamber of Secrets', stock: 15, price: 15 }).into(Books)
  })

  describe('UPDATE', () => {
    test('simple assertion', async () => {
      await expect(UPDATE(Books, '42').with({ stock: -1 })).to.be.rejectedWith(/The stock must be greater than or equal to 0/)
    })
    // TODO: constraints shall be deferred to the end of the transaction
    test.skip('at the end, everything is alright so dont complain right away', async () => {
      adminService = await cds.connect.to('AdminService')
      await adminService.tx({ user: 'alice' }, async () => {
        // first invalid
        await INSERT({ ID: 43, title: 'Harry Potter and Prisoner of Azkaban', stock: -1 }).into(Books)
        // now we make it valid
        await UPDATE(Books, '43').with({ stock: 10 })
      })
      // stock for harry potter should still be 15
      const book = await SELECT.one.from(Books).where({ ID: 43 })
      expect(book.stock).to.equal(10)
    })

    test('assertion via action', async () => {
      catService = await cds.connect.to('CatalogService')
      // try to withdraw more books than there are in stock
      await expect(catService.tx({ user: 'alice' }, async () => {
        await catService.send('submitOrder', { book: 42, quantity: 16 })
      })).to.be.rejectedWith(/The stock must be greater than or equal to 0/)

      // stock for harry potter should still be 15
      const book = await SELECT.one.from(Books).where({ ID: 42 })
      expect(book.stock).to.equal(15)
    })
  })

  describe('INSERT', () => {
    test('simple assertion, no negative stocks', async () => {
      await expect(INSERT({ ID: 43, title: 'Harry Potter and Prisoner of Azkaban', stock: -1 }).into(Books))
      .to.be.rejectedWith(/The stock must be greater than or equal to 0/)
    })

    test.only('assertion in batch', async () => {
      await expect(INSERT.into(Books).entries([
        { ID: 44, title: 'Harry Potter and the Goblet of Fire', stock: 10 },
        { ID: 45, title: 'Harry Potter and the Order of the Phoenix', stock: -1 },
      ])).to.be.rejectedWith(/The stock must be greater than or equal to 0/)
    })

    test('assertion via aggregation', async () => {
      await INSERT({ ID: 46, title: 'Harry Potter and the Half-Blood Prince', stock: 10 }).into(Books)
      const book = await SELECT.one.from(Books).where({ ID: 46 }) // no problem if no price provided
      expect(book.stock).to.equal(10)
      // Insert very expensive book
      await expect( INSERT({ ID: 47, title: 'Harry Potter and the Deathly Hallows', stock: 10, price: 1000 }).into(Books) ).to.be.rejectedWith(/The average price of the books must not exceed 50/)
    })

    test('no stock is okay', async () => {
      await INSERT({ ID: 48, title: 'Harry Potter and the Cursed Child', stock: null }).into(Books)

      const book = await SELECT.one.from(Books).where({ ID: 48 })
      expect(book).to.exist
    })
  })
})
