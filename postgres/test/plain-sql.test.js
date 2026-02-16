const cds = require('../../test/cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../test/bookshop')
const totalBooks = 6

describe('Postgres Plain SQL', () => {
  const { expect } = cds.test(bookshop)

  test('Plain sql', async () => {
    const res = await cds.run('SELECT * FROM sap_capire_bookshop_Books')
    expect(res.length).to.be.eq(totalBooks)
    const [res1, res2] = await cds.run([
      'SELECT * FROM sap_capire_bookshop_Books',
      'SELECT * FROM sap_capire_bookshop_Books',
    ])
    expect(res1.length).to.be.eq(totalBooks)
    expect(res2.length).to.be.eq(totalBooks)
  })

  test('Plain sql with values', async () => {
    const res = await cds.run('SELECT * FROM sap_capire_bookshop_Books where ID = $1', [201])
    expect(res.length).to.be.eq(1)
  })

  test('Plain sql with multiple values', async () => {
    const res = await cds.run('SELECT * FROM sap_capire_bookshop_Books where ID = $1', [[201], [252]])
    expect(res.length).to.be.eq(2)
  })
})
