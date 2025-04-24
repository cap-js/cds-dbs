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
    const { Books } = cds.entities('sap.capire.bookshop')
    // create book
    const insert = INSERT.into(Books).columns(['ID']).values([150])
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

  test('programmatic insert/upsert/update/select/delete with unknown entity', async () => {
    if(cds.env.sql.names === 'quoted') return 'skipped'
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

    const result = await SELECT.from(books)
      .where({ ID })
    expect(result.length).to.be.eq(1)

    affectedRows = await DELETE(books)
      .where({ ID })
    expect(affectedRows | 0).to.be.eq(1)
  })

  test('programmatic update without body incl. managed', async () => {
    const { Books } = cds.entities('sap.capire.bookshop')
    const { modifiedAt } = await SELECT.from(Books, { ID: 251 })
    const affectedRows = await UPDATE(Books, { ID: 251 })
    expect(affectedRows).to.be.eq(1)
    const { modifiedAt: newModifiedAt } = await SELECT.from(Books, { ID: 251 })
    expect(newModifiedAt).not.to.be.eq(modifiedAt)
  })

  test('programmatic update without body excl. managed', async () => {
    const { Genres } = cds.entities('sap.capire.bookshop')
    const affectedRows = await UPDATE(Genres, { ID: 10 })
    expect(affectedRows).to.be.eq(0)
  })

  test('programmatic update with unique constraint conflict', async () => {
    const { Genres } = cds.entities('sap.capire.bookshop')
    const update = UPDATE(Genres).set('ID = 201')
    const err = await expect(update).rejected
    // Works fine locally, but refuses to function in pipeline
    // expect(err).to.be.instanceOf(Error)
    // expect(err instanceof Error).to.be.true
    expect(err.message).to.match(/UNIQUE.CONSTRAINT/i)
  })


  test('Update with path expressions', async () => {
    const { RenameKeys } = cds.entities('AdminService')
    const updateRichardsBooks = UPDATE.entity(RenameKeys)
      .where(`author.name = 'Richard Carpenter'`)
      .set('ID = 42')
    const selectRichardsBooks = cds.ql`SELECT * FROM ${RenameKeys} where author.name = 'Richard Carpenter'`

    await cds.run(updateRichardsBooks)
    const afterUpdate = await cds.db.run(selectRichardsBooks)
    expect(afterUpdate[0]).to.have.property('foo').that.equals(42)
  })

  test('Upsert behavior validation', async () => {
    const { Books } = cds.entities('sap.capire.bookshop')

    const entries = {
      ID: 482,
      descr: 'CREATED'
    }

    const read = SELECT.one.from(Books).where(`ID = `, entries.ID)

    await UPSERT.into(Books).entries(entries)
    const onInsert = await read.clone()

    entries.descr = 'UPDATED'
    await UPSERT.into(Books).entries(entries)

    const onUpdate = await read.clone()

    // Ensure that the @cds.on.insert and @cds.on.update are being applied
    expect(onInsert.createdAt).to.be.not.undefined
    expect(onInsert.modifiedAt).to.be.not.undefined
    expect(onUpdate.createdAt).to.be.not.undefined
    expect(onUpdate.modifiedAt).to.be.not.undefined

    // Ensure that the @cds.on.insert and @cds.on.update are correctly applied
    expect(onInsert.createdAt).to.be.eq(onInsert.modifiedAt)
    expect(onInsert.createdAt).to.be.eq(onUpdate.createdAt)
    expect(onInsert.modifiedAt).to.be.not.eq(onUpdate.modifiedAt)

    // Ensure that the actual update happened
    expect(onInsert.descr).to.be.eq('CREATED')
    expect(onUpdate.descr).to.be.eq('UPDATED')
  })

  test('Upsert draft enabled entity', async () => {
    const res = await UPSERT.into('DraftService.DraftEnabledBooks').entries({ ID: 42, title: 'Foo' })
    expect(res).to.equal(1)
  })

  test('with path expressions on draft enabled service entity', async () => {
    // make sure `isActiveEntity` is not used in `UPDATE … where (<key>) in <subquery>`
    // as it is a virtual <key>
    const { MoreDraftEnabledBooks } = cds.entities('DraftService')
    const updateRichardsBooks = UPDATE.entity(MoreDraftEnabledBooks)
    .where(`author.name = 'Richard Carpenter'`)
    .set('ID = 42')
    const selectRichardsBooks = cds.ql`SELECT * FROM ${MoreDraftEnabledBooks} where author.name = 'Richard Carpenter'`

    await cds.run(updateRichardsBooks)
    const afterUpdate = await cds.db.run(selectRichardsBooks)
    expect(afterUpdate[0]).to.have.property('ID').that.equals(42)
  })
})
