const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

describe('Bookshop - Insert', () => {
  const { expect: expect1 } = cds.test(bookshop)

  test('unique constraing violation throws error', async () => {
    const { Books } = cds.entities('AdminService')
    const insert = INSERT({ ID: 201, title: 'Harry Potter' }).into(Books)
    const err = await expect1(insert).rejected
    // Works fine locally, but refuses to function in pipeline
    expect(err).toBeInstanceOf(Error)
    expect1(err).to.be.instanceOf(Error)
    expect1(err instanceof Error).to.be.true
    expect1(err.message).to.be.eq('ENTITY_ALREADY_EXISTS')
  })
})
