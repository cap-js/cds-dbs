const cds = require('../../../test/cds.js')

describe('UUID Generation', () => {
  const {expect} = cds.test(__dirname, 'model.cds')

  test('INSERT with one entry', async () => {
    const db = await cds.connect.to('db')
    return db.tx(async () => {
      await INSERT.into('test.bar').entries({})

      const result = await SELECT.from('test.bar')
      expect(result).to.have.nested.property('0.ID').to.be.a('string')

      await DELETE('test.bar')
    })
  })
  test('INSERT with multiple entries', async () => {
    const db = await cds.connect.to('db')
    return db.tx(async () => {
      await INSERT.into('test.bar').entries([{}, {}])

      const result = await SELECT.from('test.bar')
      expect(result).to.have.length(2)
      expect(result).to.have.nested.property('0.ID').to.be.a('string')
      expect(result).to.have.nested.property('1.ID').to.be.a('string')
      expect(result[0].ID).not.to.equal(result[1].ID)

      await DELETE('test.bar')
    })
  })

  test('INSERT entity with missing key as association throws error', async () => {
    await expect(
      INSERT.into('test.BooksWithAssocAsKey').entries([{}])
    ).rejectedWith({code:'SQLITE_CONSTRAINT_NOTNULL'})
  })
})
