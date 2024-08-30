const cds = require('../cds.js')
const Books = 'complex.associations.Books'
const BooksUnique = 'complex.uniques.Books'

cds.test(__dirname + '/resources')

describe('UPDATE', () => {
  describe('entity', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  describe('data', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  describe('where', () => {
    test('flat with or on key', async () => {
      const insert = await cds.run(
        INSERT.into(Books).entries([
          {
            ID: 5,
            title: 'foo',
          },
          {
            ID: 6,
            title: 'bar',
          },
        ]),
      )
      expect(insert.affectedRows).toEqual(2)

      const update = await cds.run(
        UPDATE.entity(Books)
          .set({
            title: 'foo',
          })
          .where({
            ID: 5,
            or: {
              ID: 6,
            },
          }),
      )
      expect(update).toEqual(2)
    })
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  describe('uniques in deep updates', () => {
    test('2nd level unique constraints ', async () => {
      // number must be unique for each book

      await cds.tx(async tx => {
        await tx.run(DELETE.from(BooksUnique).where({ ID: 1 }))
        await expect(
          tx.run(
            INSERT.into(BooksUnique).entries([
              {
                ID: 1,
                title: 'foo',
                pages: [
                  {
                    ID: 1,
                    number: 1,
                  },
                  {
                    ID: 2,
                    number: 1, // unique constraint violation
                  },
                ],
              },
              {
                ID: 2,
                title: 'bar',
              },
            ]),
          ),
        ).rejects.toBeTruthy()
      })

      await cds.tx(async tx => {
        await tx.run(DELETE.from(BooksUnique).where({ ID: 1 }))
        await tx.run(
          INSERT.into(BooksUnique).entries([
            {
              ID: 1,
              title: 'foo',
              pages: [
                {
                  ID: 1,
                  number: 1,
                },
                {
                  ID: 2,
                  number: 2,
                },
              ],
            },
          ]),
        )
        await tx.run(
          UPDATE(BooksUnique).data({
            ID: 1,
            title: 'foo',
            pages: [
              {
                ID: 3,
                number: 1,
              },
              {
                ID: 4,
                number: 2,
              },
            ],
          }),
        ) // first, old entries are deleted, so no violation
        await tx.run(
          UPDATE(BooksUnique).data({
            ID: 1,
            title: 'foo',
            pages: [
              {
                ID: 5,
                number: 1, // would fail without the update below first
              },
              {
                ID: 3,
                number: 999, // 1 -> 999
              },
            ],
          }),
        )
      })
    })
  })
})
