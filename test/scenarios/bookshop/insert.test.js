const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

describe('Bookshop - Insert', () => {
  cds.test(bookshop)

  test('unique constraing violation throws error', async () => {
    expect.assertions(1)
    const admin = await cds.connect.to('AdminService')
    const { Books } = admin.entities
    try {
      await admin.insert({ID:201, title: 'Harry Potter'}).into(Books)
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
    }
  })
})
