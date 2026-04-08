'use strict'
const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

describe('Bookshop - Enums', () => {
  const { expect } = cds.test(bookshop)

  test('filter by enum symbol in WHERE resolves to stored value', async () => {
    // #available resolves to 'A'; should return the 4 inventory rows with status='A'
    const { Inventory } = cds.entities('sap.capire.bookshop')
    const res = await cds.run(
      cds.ql`SELECT ID, status FROM ${Inventory} WHERE status = #available`,
    )
    expect(res).to.have.length(4)
    expect(res.every(r => r.status === 'A')).to.be.true
  })

  test('filter by enum symbols in IN list resolves all symbols', async () => {
    // #available → 'A' (4 rows) plus #out_of_stock → 'O' (1 row) = 5 total
    const { Inventory } = cds.entities('sap.capire.bookshop')
    const res = await cds.run(
      cds.ql`SELECT ID, status FROM ${Inventory} WHERE status in (#available, #out_of_stock)`,
    )
    expect(res).to.have.length(5)
    expect(res.every(r => r.status === 'A' || r.status === 'O')).to.be.true
  })

  test('insert and re-read an inventory row using enum symbol in WHERE', async () => {
    const { Inventory } = cds.entities('sap.capire.bookshop')
    await cds.run(INSERT({ ID: 9001, book_ID: 999, status: 'D', priority: 3 }).into(Inventory))
    try {
      const res = await cds.run(
        cds.ql`SELECT ID, status FROM ${Inventory} WHERE status = #discontinued AND ID = 9001`,
      )
      expect(res).to.have.length(1)
      expect(res[0].status).to.be.eq('D')
    } finally {
      await cds.run(DELETE.from(Inventory).where({ ID: 9001 }))
    }
  })
})
