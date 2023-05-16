/**
 * Make sure cqn4sql performs correct transformations.
 */
'use strict'

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds/lib')
const { expect } = cds.test
describe('query clauses', () => {
  let model
  beforeAll(async () => {
    model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  it('limit + offset', () => {
    const original = CQL`SELECT from bookshop.Books { ID } limit 50 offset 25`
    expect(cqn4sql(original, model)).to.deep.equal(
      CQL`
      SELECT from bookshop.Books as Books { Books.ID } limit 50 offset 25
     `,
    )
  })

  it('`sort` and `nulls` are passed along in order by', () => {
    const original = CQL`
        SELECT from bookshop.Books { ID }
            order by Books.ID asc nulls first,
                     1 + 1 desc nulls last,
                     func() desc nulls first
    `
    expect(cqn4sql(original, model)).to.deep.equal(
      CQL`
      SELECT from bookshop.Books as Books { Books.ID }
        order by Books.ID asc nulls first,
                 1 + 1 desc nulls last,
                 func() desc nulls first
     `,
    )
  })
  it('`sort` and `nulls` are passed along also to flat field in order by', () => {
    const original = CQL`SELECT from bookshop.Books { ID } order by Books.dedication.sub asc nulls first`
    expect(cqn4sql(original, model)).to.deep.equal(
      CQL`
      SELECT from bookshop.Books as Books { Books.ID }
        order by Books.dedication_sub_foo asc nulls first
     `,
    )
  })
  it('preserves cast property on column', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Bar {
            ID as castedID: cds.String
          }`,
      model,
    )
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Bar as Bar {
            Bar.ID as castedID: cds.String
          }`)
  })
  // a sql renderer will most likely just wrap the whole column into "cast(`col` as `type`)"
  // --> the implicit alias for that column would therefore equal the name of the cast function
  //     hence we should make the alias explicit for the cds style cast
  it('adds explicit alias for cast property on column', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Bar {
            ID: cds.String
          }`,
      model,
    )
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Bar as Bar {
            Bar.ID as ID: cds.String
          }`)
  })
})
