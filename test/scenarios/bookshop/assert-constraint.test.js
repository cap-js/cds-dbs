const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

describe('Bookshop - assertions', () => {
  const { expect, POST } = cds.test(bookshop)
  let adminService, catService, Books, Genres

  before('bootstrap the database', async () => {
    Books = cds.entities.Books
    Genres = cds.entities.Genres
    await INSERT({ ID: 42, title: 'Harry Potter and the Chamber of Secrets', stock: 15, price: 15 }).into(Books)
  })

  describe('UPDATE', () => {
    test('simple assertion', async () => {
      await expect(UPDATE(Books, '42').with({ stock: -1 })).to.be.rejectedWith(
        /The stock must be greater than or equal to 0/,
      )
    })

    test('at the end, everything is alright so dont complain right away', async () => {
      adminService = await cds.connect.to('AdminService')
      await adminService.tx({ user: 'alice' }, async () => {
        // first invalid
        await INSERT({ ID: 49, title: 'Harry Potter and the Deathly Hallows II', stock: -1 }).into(Books)
        // now we make it valid
        await UPDATE(Books, '49').with({ stock: 10 })
      })
    })

    test('assertion via action', async () => {
      catService = await cds.connect.to('CatalogService')
      // try to withdraw more books than there are in stock
      await expect(
        catService.tx({ user: 'alice' }, async () => {
          await catService.send('submitOrder', { book: 42, quantity: 16 })
        }),
      ).to.be.rejectedWith(/The stock must be greater than or equal to 0/)

      // stock for harry potter should still be 15
      const book = await SELECT.one.from(Books).where({ ID: 42 })
      expect(book.stock).to.equal(15)
    })
  })

  describe('INSERT', () => {
    test('simple assertion, no negative stocks', async () => {
      await expect(
        INSERT({ ID: 43, title: 'Harry Potter and Prisoner of Azkaban', stock: -1 }).into(Books),
      ).to.be.rejectedWith(/The stock must be greater than or equal to 0/)
    })

    test('assertion in batch', async () => {
      await expect(
        INSERT.into(Books).entries([
          { ID: 44, title: 'Harry Potter and the Goblet of Fire', stock: 10 },
          { ID: 45, title: 'Harry Potter and the Order of the Phoenix', stock: -1 },
        ]),
      ).to.be.rejectedWith(/The stock must be greater than or equal to 0/)
    })

    test('no stock is okay', async () => {
      await INSERT({ ID: 48, title: 'Harry Potter and the Cursed Child', stock: null }).into(Books)

      const book = await SELECT.one.from(Books).where({ ID: 48 })
      expect(book).to.exist
    })

    test('deepInsert should not proceed after constraint violation in header', async () => {
      await expect(
        POST(
          '/admin/Authors',
          {
            ID: 55,
            name: 'Brandon Sanderson',
            dateOfBirth: null, // mixed up date of birth and date of death
            dateOfDeath: '1975-12-19',
            books: [
              {
                ID: 55,
                title: 'The Way of Kings',
                stock: 10,
                price: 10,
              },
            ],
          },
          { auth: { username: 'alice' } },
        ),
      ).to.be.rejectedWith(/The date of birth must be before the date of death/)
      // book should not have been created
      const book = await SELECT.one.from(Books).where({ ID: 55 })
      expect(book).to.not.exist
    })

    test('deep insert violates constraint with path expression', async () => {
      await expect(
        POST('admin/Genres', {
          ID: 90,
          name: 'Fairy Tale', // OK
          children: [
            { ID: 91, name: 'Fable' }, // NOT OK
          ]
        }, { auth: { username: 'alice' } })
      ).to.be.rejectedWith(/@assert.constraint ”children” failed/)
      const genre = await SELECT.from(Genres).where('ID in (90, 91)')
      expect(genre).to.be.empty
      // positive case
      await POST('admin/Genres', {
        ID: 100,
        name: 'New Genre', // OK
        children: [
          { ID: 101, name: 'New Sub-Genre' }, // also OK
        ],
      }, { auth: { username: 'alice' } })
      const genres = await SELECT.from(Genres).where('ID in (100, 101)')
      // both should have been created
      expect(genres).to.have.length(2)
    })
  })
})
