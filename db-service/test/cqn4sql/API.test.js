/**
 * Make sure cqn4sql always works on a copy of the incoming query, enabling
 * extension scenarios and repetitive calls.
 */
'use strict'

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds/lib')
const { expect } = cds.test
describe('Repetitive calls to cqn4sql must work', () => {
  let model
  beforeAll(async () => {
    model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  it('query can be extended by another element', () => {
    const original = CQL`SELECT from bookshop.Books { ID }`
    let query = cqn4sql(original, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID }`)
    original.SELECT.columns.push({ ref: ['title'] })
    query = cqn4sql(original, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID, Books.title }`)
    original.SELECT.where = ['exists', { ref: ['author'] }]
    query = cqn4sql(original, model)
    expect(query).to.deep.equal(
      CQL`
      SELECT from bookshop.Books as Books
      { Books.ID, Books.title }
      WHERE EXISTS (
        SELECT 1 from bookshop.Authors as author where author.ID = Books.author_ID
      )
     `,
    )
  })

  it('accepts empty select list', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Books { }`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { }`)
  })

  it('yields the same result if same query is transformed multiple times', () => {
    const input = CQL`SELECT from bookshop.Books:author`
    let query = cqn4sql(input, model)
    let query2 = cqn4sql(input, model)
    expect(query).to.deep.equal(query2)
  })
  it('yields the same result if same query is transformed multiple times (2)', () => {
    const input = CQL`SELECT from bookshop.Books where author.name like '%Poe'`
    let query = cqn4sql(input, model)
    let query2 = cqn4sql(input, model)
    expect(query2).to.deep.equal(query)
  })
})
