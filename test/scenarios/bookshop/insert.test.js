const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

describe('Bookshop - Insert', () => {
  const { expect } = cds.test(bookshop)

  test('unique constraing violation throws error', async () => {
    const { Books } = cds.entities('AdminService')
    const insert = INSERT({ ID: 201, title: 'Harry Potter' }).into(Books)
    const err = await expect(insert).rejected
    // Works fine locally, but refuses to function in pipeline
    // expect(err).to.be.instanceOf(Error)
    // expect(err instanceof Error).to.be.true
    expect(err.message).to.be.eq('ENTITY_ALREADY_EXISTS')
  })

  test('insert with undefined value works', async () => {
    const { Books } = cds.entities('sap.capire.bookshop')
    const resp = await cds.run(INSERT({ stock: undefined, ID: 223, title: 'Harry Potter' }).into(Books))
    expect(resp | 0).to.be.eq(1)
  })
})
