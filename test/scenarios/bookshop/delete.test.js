const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

describe('Bookshop - Delete', () => {
  const { expect } = cds.test(bookshop)

  test('Deep delete works for queries with multiple where clauses', async () => {
    const del3 = SELECT.from('sap.capire.bookshop.Genres')
    const affectedRows3 = await cds.db.run(del3)
    const del = DELETE.from('sap.capire.bookshop.Genres[ID = 10]')
    const affectedRows = await cds.db.run(del)
    const del2 = SELECT.from('sap.capire.bookshop.Genres[ID = 10]')
    const affectedRows2 = await cds.db.run(del2)
    expect(affectedRows).to.be.eq(0)
  })

  test(`Deep delete rejects transitive circular dependencies`, async () => {
    await INSERT.into('sap.capire.bookshop.A').entries([
      { ID: 999 },
      { ID: 998 },
      {
        ID: 1,
        toB: {
          ID: 12,
          toA: [{ ID: 121 }],
          toC: [
            {
              ID: 123,
              toB: [
                {
                  ID: 1232,
                  toC: [
                    {
                      ID: 12323,
                      toA: [{ ID: 123231 }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        toC: {
          ID: 13,
          toA: [{ ID: 13 }],
        },
      },
    ])
    const del = DELETE.from('sap.capire.bookshop.A').where('ID = 1')
    await expect(cds.db.run(del)).to.be.eventually.rejectedWith('Transitive circular composition detected')
  })

  test('Delete with path expressions', async () => {
    const deleteEmilysBooks = DELETE.from('AdminService.RenameKeys').where(`author.name = 'Emily Brontë'`)
    const selectEmilysBooks = cds.ql`SELECT * FROM AdminService.Books where author.name = 'Emily Brontë'`

    const beforeDelete = await cds.run(selectEmilysBooks)
    await cds.run(deleteEmilysBooks)
    const afterDelete = await cds.run(selectEmilysBooks)
    expect(beforeDelete).to.have.lengthOf(1)
    expect(afterDelete).to.have.lengthOf(0)
  })
})
