const cds = require('../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../bookshop')

/**
 * Tests explicitely, that all DBs behave exactly the same for affected rows
 */
describe('affected rows', () => {
  const { expect } = cds.test(bookshop)

  test('Delete returns affected rows', async () => {
    const del = DELETE.from('sap.capire.bookshop.Genres[ID = 4711]').where('ID = 4712')
    const affectedRows = await cds.db.run(del)
    expect(affectedRows).to.be.eq(0)
  })

  test('Insert returns affected rows and InsertResult', async () => {
    const insert = INSERT.into('sap.capire.bookshop.Genres').entries({ ID: 5 })
    const affectedRows = await cds.db.run(insert)
    // affectedRows is an InsertResult, so we need to do lose comparison here, as strict will not work due to InsertResult
    expect(affectedRows == 1).to.be.eq(true)
    // the actual InsertResult looks like this
    expect(affectedRows).to.deep.include({ affectedRows: 1, results: [{ changes: 1/*, lastInsertRowid: 5*/ }] }) // lastInsertRowid not available on postgres
  })

  test('Update returns affected rows', async () => {
    const authors = await cds.db.run(SELECT.from('sap.capire.bookshop.Authors'))
    
    const affectedRows = await cds.db.run(UPDATE.entity('sap.capire.bookshop.Authors').data({name: 'Author'}))
    expect(affectedRows).to.be.eq(authors.length)
  })

  test('Upsert returns affected rows', async () => { 
    const affectedRows = await cds.db.run(UPSERT.into('sap.capire.bookshop.Authors').entries({ID: 9999999, name: 'Author'}))
    expect(affectedRows).to.be.eq(1)
  })
})
