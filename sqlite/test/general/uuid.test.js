const cds = require('../../../test/cds.js')
cds.test(__dirname, 'model.cds')

describe('UUID Generation', () => {
  test('INSERT with one entry', async () => {
    const db = await cds.connect.to('db')
    return db.tx(async () => {
      await INSERT.into('test.bar').entries({})

      const result = await SELECT.from('test.bar')
      expect(result).toEqual([{ ID: expect.any(String) }])

      await DELETE('test.bar')
    })
  })
  test('INSERT with multiple entries', async () => {
    const db = await cds.connect.to('db')
    return db.tx(async () => {
      await INSERT.into('test.bar').entries([{}, {}])

      const result = await SELECT.from('test.bar')
      expect(result).toEqual([{ ID: expect.any(String) }, { ID: expect.any(String) }])
      expect(result[0].ID).not.toEqual(result[1].ID)

      await DELETE('test.bar')
    })
  })

  test('INSERT entity with missing key as association throws error', async () => {
    expect.assertions(1)
    return expect(
      cds.run(INSERT.into('test.BooksWithAssocAsKey').entries([{}]))
    ).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_NOTNULL' })   
  })
})
