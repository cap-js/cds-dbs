const cds = require('../../test/cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../test/bookshop')

describe('HANA Plain SQL', () => {
  describe.each([{mode: 'quoted'}, {mode: 'plain'}])('$mode', ({mode}) => {
    cds.env.sql.names = mode
    const { expect } = cds.test(bookshop)

    test('Plain sql', async () => {
      const res = await cds.run('SELECT * FROM sap_capire_bookshop_Books')
      expect(res.length).to.be.eq(5)

      const [res1, res2] = await cds.run([
        'SELECT * FROM sap_capire_bookshop_Books',
        'SELECT * FROM sap_capire_bookshop_Books',
      ])
      expect(res1.length).to.be.eq(5)
      expect(res2.length).to.be.eq(5)
    })

    test('Plain sql with values', async () => {
      const res = await cds.run('SELECT * FROM sap_capire_bookshop_Books where ID = ?', [201])
      expect(res.length).to.be.eq(1)
    })

    test('Plain sql with multiple values', async () => {
      const res = await cds.run('SELECT * FROM sap_capire_bookshop_Books where ID = ?', [[201], [252]])
      expect(res.length).to.be.eq(2)
    })
  })
})
