const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

describe('Bookshop - Delete', () => {
  const { expect } = cds.test(bookshop)

  test('Deep delete works for queries with multiple where clauses', async () => {
    const del = DELETE.from('sap.capire.bookshop.Genres[ID = 4711]').where('ID = 4712')
    const affectedRows = await cds.db.run(del)
    expect(affectedRows).to.be.eq(1)
  })
})