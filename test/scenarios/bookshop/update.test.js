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

  test('Update Book (with timestamp)', async () => {
    const descr = `"${new Date().toISOString()}"`
    const res = await PUT(
      '/admin/Books(201)',
      { descr },
      admin,
    )
    expect(res.status).to.be.eq(200)
    expect(res.data.descr).to.be.eq(descr)
  })

  test('Update array of', async () => {
    // create book
    const insert = INSERT.into('sap.capire.bookshop.Books').columns(['ID']).values([150])
    await cds.run(insert)

    const update = await PUT(
      '/admin/Books(150)', // UPSERT new footnotes
      {
        descr: 'UPDATED',
        footnotes: ['one'],
      },
      admin,
    )
    expect(update.status).to.be.eq(200)
    expect(update.data.footnotes).to.be.eql(['one'])
  })

  test('programmatic insert/upsert/update/delete with unknown entity', async () => {
    const books = 'sap_capire_bookshop_Books'
    const ID = 999
    let affectedRows = await INSERT.into(books)
      .entries({
        ID,
        createdAt: (new Date()).toISOString(),
      })
    expect(affectedRows | 0).to.be.eq(1)

    affectedRows = await DELETE(books)
      .where({ ID })
    expect(affectedRows | 0).to.be.eq(1)

    affectedRows = await INSERT.into(books)
      .columns(['ID', 'createdAt'])
      .values([ID, (new Date()).toISOString()])
    expect(affectedRows | 0).to.be.eq(1)

    affectedRows = await UPDATE(books)
      .with({ modifiedAt: (new Date()).toISOString() })
      .where({ ID })
    expect(affectedRows | 0).to.be.eq(1)

    affectedRows = await DELETE(books)
      .where({ ID })
    expect(affectedRows | 0).to.be.eq(1)

    // UPSERT fallback to an INSERT
    affectedRows = await UPSERT.into(books)
      .entries({
        ID,
        createdAt: (new Date()).toISOString(),
      })
    expect(affectedRows | 0).to.be.eq(1)

    // UPSERT fallback to an INSERT (throws on secondary call)
    affectedRows = UPSERT.into(books)
      .entries({
        ID,
        createdAt: (new Date()).toISOString(),
      })
    await expect(affectedRows).rejected
    
    affectedRows = await DELETE(books)
      .where({ ID })
    expect(affectedRows | 0).to.be.eq(1)
  })

  test('programmatic update without body incl. managed', async () => {
    const { modifiedAt } = await SELECT.from('sap.capire.bookshop.Books', { ID: 251 })
    const affectedRows = await UPDATE('sap.capire.bookshop.Books', { ID: 251 })
    expect(affectedRows).to.be.eq(1)
    const { modifiedAt: newModifiedAt } = await SELECT.from('sap.capire.bookshop.Books', { ID: 251 })
    expect(newModifiedAt).not.to.be.eq(modifiedAt)
  })

  test('programmatic update without body excl. managed', async () => {
    const affectedRows = await UPDATE('sap.capire.bookshop.Genres', { ID: 10 })
    expect(affectedRows).to.be.eq(0)
  })

  test('Update with path expressions', async () => {
    const updateRichardsBooks = UPDATE.entity('AdminService.RenameKeys')
      .where(`author.name = 'Richard Carpenter'`)
      .set('ID = 42')
    const selectRichardsBooks = CQL`SELECT * FROM AdminService.RenameKeys where author.name = 'Richard Carpenter'`

    await cds.run(updateRichardsBooks)
    const afterUpdate = await cds.db.run(selectRichardsBooks)
    expect(afterUpdate[0]).to.have.property('foo').that.equals(42)
  })
})
