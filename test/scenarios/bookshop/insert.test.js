const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

describe('Bookshop - Insert', () => {
  const { expect } = cds.test(bookshop)

  test.only('unique constraing violation throws error', async () => {
    const { Books } = cds.entities('AdminService')

    const insert = INSERT({ ID: 201, title: 'Harry Potter' }).into(Books)

    const err = await expect(insert).rejected
    expect(err).to.be.instanceOf(Error)
    expect(err.message).to.be.eq('ENTITY_ALREADY_EXISTS')
  })
})
