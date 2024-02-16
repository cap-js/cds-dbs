const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

describe('Bookshop - Insert', () => {
  const { expect } = cds.test(bookshop)

  test('unique constraing violation throws error', async () => {
    const { Books } = cds.entities('AdminService')
    try {
      await INSERT({ ID: 201, title: 'Harry Potter' }).into(Books)
    } catch (err) {
      expect(err).to.be.instanceOf(Error)
      expect(err.message).to.be.eq('ENTITY_ALREADY_EXISTS')
      return
    }
    expect('Unique constraint error was not thrown').to.be.undefined
  })
})
