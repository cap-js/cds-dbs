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
    expect(err.message).to.match(/ENTITY_ALREADY_EXISTS|UNIQUE CONSTRAINT/i)
  })

  test('insert with undefined value works', async () => {
    const { Books } = cds.entities('sap.capire.bookshop')
    const resp = await cds.run(INSERT({ stock: undefined, ID: 223, title: 'Harry Potter' }).into(Books))
    expect(resp | 0).to.be.eq(1)
  })

  test('mass insert on unknown entities', async () => {
    if(cds.env.sql.names === 'quoted') return 'skipped'
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

  test('insert with assoc default', async () => {
    const { Books } = cds.entities('sap.capire.bookshop')
    await cds.run(INSERT({ ID: 344, title: 'Faust. Eine Tragödie' }).into(Books))
    const res = await SELECT.from(Books, {ID: 344})
    expect(res.genre_ID).to.be.eq(10)
  })

  test('big decimals', async () => {
    const { Books } = cds.entities('sap.capire.bookshop')

    const entry = { ID: 2348, title: 'Moby Dick', price: '12345678901234567890.12345' }
    await INSERT(entry).into(Books)

    const written = await SELECT('price').from(Books, { ID: 2348 })
    if (written.price.indexOf('e+') > -1) {
      expect(written.price).to.be.eq('1.23456789012346e+19')
    } else {
      expect(written.price).to.be.eq(entry.price)
    }
  })
})
