const cds = require('../../test/cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../test/bookshop')

describe('db-edge', () => {
  describe('Bookshop - Read', () => {
    const { expect, GET } = cds.test(bookshop)

    test('Books', async () => {
      // Initial run of the test is deployed to all databases
      let res = await GET('/browse/Books', { headers: { 'accept-language': 'de' } })
      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(5)

      // Reconnect to the db which will wipe the SQLite instance
      await cds.db.disconnect()
      const db = await cds.connect.to('db')

      // Validate that the SQLite db is corrupted
      await expect(GET('/browse/Books', { headers: { 'accept-language': 'de' } })).rejected

      // Sync edge database
      await db.sync()

      // Read synchronized data from edge database
      res = await GET('/browse/Books', { headers: { 'accept-language': 'de' } })
      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(5)
    })
  })
})
