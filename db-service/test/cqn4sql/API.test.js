/**
 * Make sure cqn4sql always works on a copy of the incoming query, enabling
 * extension scenarios and repetitive calls.
 */
'use strict'

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds')
const { expect } = cds.test
describe('Repetitive calls to cqn4sql must work', () => {
  let model
  beforeAll(async () => {
    model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  it('query can be extended by another element', () => {
    const original = cds.ql`SELECT from bookshop.Books as Books { ID }`
    let query = cqn4sql(original, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books { Books.ID }`)
    original.SELECT.columns.push({ ref: ['title'] })
    query = cqn4sql(original, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books { Books.ID, Books.title }`)
    original.SELECT.where = ['exists', { ref: ['author'] }]
    query = cqn4sql(original, model)
    expect(query).to.deep.equal(
      cds.ql`
      SELECT from bookshop.Books as Books
      { Books.ID, Books.title }
      WHERE EXISTS (
        SELECT 1 from bookshop.Authors as $a where $a.ID = Books.author_ID
      )
     `,
    )
  })

  it('accepts empty select list', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { }`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books { }`)
    expect(query.SELECT.columns.length).to.be.eq(0); // no items inside SELECT.columns
    expect(query.SELECT.groupBy?.length || 0).to.be.eq(0); // no items inisde SELECT.groupBy
  })

  it('accepts empty select list with groupby - return select with attribute inside groupby', () => {
    // FIX https://github.com/cap-js/cds-dbs/issues/1228
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { } GROUP BY Books.author.name, Books.author.ID`, model)

    expect(query.SELECT.columns.length).to.be.eq(2);
    expect(query.SELECT.columns).to.deep.equal(query.SELECT.groupBy); // We expect to have same values from groupBy into SELECT.columns
    expect(query.SELECT.columns).to.deep.equal([{ ref: ['author', 'name'] }, { ref: ['Books', 'author_ID'] }]);
  })

  it('yields the same result if same query is transformed multiple times', () => {
    const input = cds.ql`SELECT from bookshop.Books:author`
    let query = cqn4sql(input, model)
    let query2 = cqn4sql(input, model)
    expect(query).to.deep.equal(query2)
  })
  it('yields the same result if same query is transformed multiple times (2)', () => {
    const input = cds.ql`SELECT from bookshop.Books where author.name like '%Poe'`
    let query = cqn4sql(input, model)
    let query2 = cqn4sql(input, model)
    expect(query2).to.deep.equal(query)
  })
})
