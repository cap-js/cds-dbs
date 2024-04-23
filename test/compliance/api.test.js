const cds = require('../cds.js')

/**
 * Tests explicitely, that all DBs behave exactly the same for affected rows
 */
describe('affected rows', () => {
const { expect } = cds.test(__dirname + '/resources')

  test('Delete returns affected rows', async () => {
    const affectedRows = await DELETE.from('complex.associations.Books').where('ID = 4712')
    expect(affectedRows).to.be.eq(0)
  })

  test('Insert returns affected rows and InsertResult', async () => {
    const insert = INSERT.into('complex.associations.Books').entries({ ID: 5 })
    const affectedRows = await cds.db.run(insert)
    // affectedRows is an InsertResult, so we need to do lose comparison here, as strict will not work due to InsertResult
    expect(affectedRows == 1).to.be.eq(true)
    // InsertResult
    expect(affectedRows).to.include({ affectedRows: 1 }) // lastInsertRowid not available on postgres
  })

  test('Update returns affected rows', async () => {
    const { count } = await SELECT.one`count(*)`.from('complex.associations.Books')
    
    const affectedRows = await UPDATE.entity('complex.associations.Books').data({title: 'Book'})
    expect(affectedRows).to.be.eq(count)
  })

  test('Upsert returns affected rows', async () => { 
    const affectedRows = await UPSERT.into('complex.associations.Books').entries({ID: 9999999, title: 'Book'})
    expect(affectedRows).to.be.eq(1)
  })
})
