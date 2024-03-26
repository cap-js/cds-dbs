const cds = require('../../cds.js')
const bookshop = require('path').resolve(__dirname, '../../bookshop')

describe('Bookshop - Order By', () => {
  const { expect } = cds.test(bookshop)

  test('collations', async () => {
    // the original query is sorted by the **column** "createdBy"
    // the resulting query has two query sources in the end --> Authors and Books
    // even though both Tables have the element "createdBy", the DB should be able to resolve the
    // order by reference to the column unambiguously
    const query = CQL(`SELECT from sap.capire.bookshop.Books {
      createdBy,
      author.name as author
    } order by createdBy`)
    const res = await cds.run(query)
    expect(res.length).to.be.eq(5)
  })
  test('collations with val', async () => {
    const query = CQL(`SELECT from sap.capire.bookshop.Books {
      'simple string' as foo: cds.String,
      author.name as author
    } order by foo`)
    query.SELECT.localized = true
    const res = await cds.run(query)
    expect(res.length).to.be.eq(5)
  })
  test('collations with func', async () => {
    const query = CQL(`SELECT from sap.capire.bookshop.Books {
      concat('simple string') as bar: cds.String,
      author.name as author
    } order by bar`)
    const res = await cds.run(query)
    expect(res.length).to.be.eq(5)
  })
  test('collations with xpr', async () => {
    const query = CQL(`SELECT from sap.capire.bookshop.Books {
      'simple' || 'string' as baz: cds.String,
      author.name as author
    } order by baz`)
    const res = await cds.run(query)
    expect(res.length).to.be.eq(5)
  })
})
