const cds = require('../../cds.js')
const bookshop = require('path').resolve(__dirname, '../../bookshop')

describe('Bookshop - Order By', () => {
  const { expect } = cds.test(bookshop)

  test('collations', async () => {
    // the original query is sorted by the **column** "createdBy"
    // the resulting query has two query sources in the end --> Authors and Books
    // even though both Tables have the element "createdBy", the DB should be able to resolve the
    // order by reference to the column unambiguously
    const query = cds.ql`SELECT from sap.capire.bookshop.Books {
      createdBy,
      author.name as author
    } order by createdBy, author
      limit 1`
    const res = await cds.run(query)
    expect(res.length).to.be.eq(1)
    expect(res[0].author).to.eq('Charlotte Brontë')
  })
  test('collations for aggregating queries with subselect', async () => {
    const subquery = SELECT.localized.from('sap.capire.bookshop.Books').orderBy('title')
    const query = SELECT.localized.from(subquery).columns('title', 'sum(price) as pri').limit(1).groupBy('title').orderBy('title')

    query.SELECT.count = true

    const res = await cds.run(query)
    expect(res.length).to.be.eq(1)
    expect(res[0]).to.eql({ title: 'Catweazle', pri: 150})
  })
  test('collations with val', async () => {
    if(cds.env.requires.db.impl === '@cap-js/hana')
      return // FIXME: the `val` is put into window function, which ends in an error on HANA
    const query = CQL(`SELECT from sap.capire.bookshop.Books {
      'simple string' as foo: cds.String,
      author.name as author
    } order by foo, author
      limit 1`)
    query.SELECT.localized = true
    const res = await cds.run(query)
    expect(res.length).to.be.eq(1)
    expect(res[0].author).to.eq('Charlotte Brontë')
  })
  test('collations with func', async () => {
    const query = CQL(`SELECT from sap.capire.bookshop.Books {
      concat('simple', 'string') as bar: cds.String,
      author.name as author
    } order by bar, author
      limit 1`)
    const res = await cds.run(query)
    expect(res.length).to.be.eq(1)
    expect(res[0].author).to.eq('Charlotte Brontë')
  })
  test('collations with xpr', async () => {
    const query = CQL(`SELECT from sap.capire.bookshop.Books {
      'simple' || 'string' as baz: cds.String,
      author.name as author
    } order by baz, author
      limit 1`)
    const res = await cds.run(query)
    expect(res.length).to.be.eq(1)
    expect(res[0].author).to.eq('Charlotte Brontë')
  })

  test('nulls first | last', async () => {
    const { Authors } = cds.entities('sap.capire.bookshop')
    await INSERT.into(Authors).entries({ ID: 42, name: 'Brandon Sanderson' }) // dateOfDeath => null
    const nullsFirst = await cds.ql`SELECT from ${Authors} { name } order by dateOfDeath asc nulls first`
    expect(nullsFirst[0].name).to.eq('Brandon Sanderson')
    const nullsLast = await cds.ql`SELECT from ${Authors} { name } order by dateOfDeath asc nulls last`
    expect(nullsLast.at(-1).name).to.eq('Brandon Sanderson')
  });
})
