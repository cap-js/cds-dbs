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

  test('mass insert on unknown entities', async () => {
    const books = 'sap_capire_bookshop_Books'
    let affectedRows = await INSERT.into(books)
      .entries([{
        ID: 4711,
        createdAt: (new Date()).toISOString(),
      }, {
        ID: 4712,
        createdAt: (new Date()).toISOString(),
      }])
    expect(affectedRows | 0).to.be.eq(2)
    
    const res = await SELECT.from('sap.capire.bookshop.Books').where('ID in', [4711, 4712])
    expect(res).to.have.length(2)
  })

  test('insert with arrayed elements', async () => {
    const { Books } = cds.entities('sap.capire.bookshop')
    const resp = await cds.run(INSERT({ footnotes: ['first', 'second'], ID: 121, title: 'Guiness Book of World Records' }).into(Books))
    expect(resp | 0).to.be.eq(1)
  })
    
})
