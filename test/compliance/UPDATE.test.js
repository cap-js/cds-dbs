const cds = require('../cds.js')
const Books = 'complex.associations.Books'

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
    const {expect} = cds.test(__dirname + '/resources')
    test('flat with or on key', async () => {
      const entires = [
        {
          ID: 5,
          title: 'foo',
        },
        {
          ID: 6,
          title: 'bar',
        },
      ]

      const insert = await cds.run(INSERT.into(Books).entries(entires))
      expect(insert.affectedRows).to.equal(2)

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
      expect(update).to.equal(2)
    })
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
})
