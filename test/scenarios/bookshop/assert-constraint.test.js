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
    test.only('simple assertion', async () => {
      await expect(UPDATE(Books, '42').with({ stock: -1 })).to.be.rejectedWith(
        'Stock for book "Harry Potter and the Chamber of Secrets" (42) must not be a negative number',
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
      ).to.be.rejectedWith('Stock for book "Harry Potter and the Chamber of Secrets" (42) must not be a negative number')

      // stock for harry potter should still be 15
      const book = await SELECT.one.from(Books).where({ ID: 42 })
      expect(book.stock).to.equal(15)
    })

    test('update fails because deeply nested child violates constraint', async () => {
      await expect(
        UPDATE(Genres).with({
          name: 'Non-Fiction Updated',
          children: [
            {
              ID: 21,
              name: 'SUPER BIOGRAPHY',
              children: [
                {
                  ID: 22,
                  name: 'We forbid genre names with more than 20 characters',
                },
              ],
            }
          ],
        }).where(`name = 'Non-Fiction' and ID = 20`),
      ).to.be.rejectedWith('Genre name "We forbid genre names with more than 20 characters" exceeds maximum length of 20 characters')
    })

    test('update fails because parent AND deeply nested child violates constraint', async () => {
      try {
        await UPDATE(Genres).with({
          name: 'Non-Fiction Updated with a waaaaaay to long name',
          children: [
            {
              ID: 21,
              name: 'SUPER BIOGRAPHY',
              children: [
                {
                  ID: 22,
                  name: 'We forbid genre names with more than 20 characters',
                },
              ],
            }
          ],
        }).where(`name = 'Non-Fiction' and ID = 20`)
      } catch (err) {
        const { details } = err
        expect(details).to.have.length(2)
        expect(details[0].message).to.equal('Genre name "Non-Fiction Updated with a waaaaaay to long name" exceeds maximum length of 20 characters')
        expect(details[1].message).to.equal('Genre name "We forbid genre names with more than 20 characters" exceeds maximum length of 20 characters')
      }
    })
  })

  describe('INSERT', () => {

    test('simple assertion, no negative stocks', async () => {
      await expect(
        INSERT({ ID: 43, title: 'Harry Potter and Prisoner of Azkaban', stock: -1 }).into(Books),
      ).to.be.rejectedWith('Stock for book "Harry Potter and Prisoner of Azkaban" (43) must not be a negative number')
    })

    test('assertion in batch', async () => {
      await expect(
        INSERT.into(Books).entries([
          { ID: 44, title: 'Harry Potter and the Goblet of Fire', stock: 10 },
          { ID: 45, title: 'Harry Potter and the Order of the Phoenix', stock: -1 },
        ]),
      ).to.be.rejectedWith('Stock for book "Harry Potter and the Order of the Phoenix" (45) must not be a negative number')
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
            dateOfBirth: '2025-01-01', // mixed up date of birth and date of death
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
      ).to.be.rejectedWith('The Birthday "2025-01-01" of author "Brandon Sanderson" must not be after the Deathday "1975-12-19"')
      // book should not have been created
      const book = await SELECT.one.from(Books).where({ ID: 55 })
      expect(book).to.not.exist
    })

    test('deep insert should not be fulfilled after constraint violation in child', async () => {
      await expect(
        POST(
          '/admin/Genres',
          {
            ID: 256,
            name: 'Fantasy',
            children: [
              {
                ID: 56,
                name: 'Fable',
                children: [
                  {
                    ID: 58,
                    name: 'We forbid genre names with more than 20 characters', // how to check violations in deep operations?
                  }]
              },
              {
                ID: 57,
                name: 'Sibling Fable',
              }
            ]
          },
          { auth: { username: 'alice' } },
        ),
      ).to.be.rejectedWith('Genre name "We forbid genre names with more than 20 characters" exceeds maximum length of 20 characters')
    })

    test('deep insert via different entities', async () => {
      await expect(
        POST(
          '/admin/A',
          {
            ID: 1,
            toB: [
              {
                ID: 2,
                A: 42
              },
            ],
          },
          { auth: { username: 'alice' } },
        ),
      ).to.be.rejectedWith('A must not be 42')
    })

    test('assertion in batch (make sure there is only one query in the end)', async () => {
      await expect(
        INSERT.into(Books).entries([
          { ID: 500, title: 'The Way of Kings', stock: 10 },
          { ID: 501, title: 'Words of Radiance', stock: -1 },
          { ID: 502, title: 'Oathbringer', stock: 10 },
          { ID: 503, title: 'Edgedancer', stock: 10 },
          { ID: 504, title: 'Dawnshard', stock: 10 },

        ]),
      ).to.be.rejectedWith('Stock for book "Words of Radiance" (501) must not be a negative number')
    })
  })
})
