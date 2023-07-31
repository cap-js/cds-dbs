const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

const admin = {
  auth: {
    username: 'alice',
  },
}

describe('Bookshop - Update', () => {
  const { expect, PUT } = cds.test(bookshop)

  test('Update Book', async () => {
    const res = await PUT(
      '/admin/Books(201)', // was Books(2) -> UPSERT
      {
        descr: 'UPDATED',
        author: { ID: 201 },
      },
      admin,
    )
    expect(res.status).to.be.eq(200)

    expect(res.data.author_ID).to.be.eq(201)
    expect(res.data.descr).to.be.eq('UPDATED')
  })

  test('programmatic update without body incl. managed', async () => {
    const { modifiedAt } = await cds.db.run(cds.ql.SELECT.from('sap.capire.bookshop.Books', { ID: 251 }))
    const affectedRows = await cds.db.run(cds.ql.UPDATE('sap.capire.bookshop.Books', { ID: 251 }))
    expect(affectedRows).to.be.eq(1)
    const { modifiedAt: newModifiedAt } = await cds.db.run(cds.ql.SELECT.from('sap.capire.bookshop.Books', { ID: 251 }))
    expect(newModifiedAt).not.to.be.eq(modifiedAt)
  })

  test('programmatic update without body excl. managed', async () => {
    const affectedRows = await cds.db.run(cds.ql.UPDATE('sap.capire.bookshop.Genres', { ID: 10 }))
    expect(affectedRows).to.be.eq(0)
  })
})
