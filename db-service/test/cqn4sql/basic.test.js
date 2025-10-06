/**
 * Make sure cqn4sql performs correct transformations.
 */
'use strict'

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds')
const { expect } = cds.test
describe('query clauses', () => {
  let model
  beforeAll(async () => {
    model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  it('limit + offset', () => {
    const original = cds.ql`SELECT from bookshop.Books as Books { ID } limit 50 offset 25`
    expect(cqn4sql(original, model)).to.deep.equal(
      cds.ql`
      SELECT from bookshop.Books as Books { Books.ID } limit 50 offset 25
     `,
    )
  })

  it('`sort` and `nulls` are passed along in order by', () => {
    const original = cds.ql`
        SELECT from bookshop.Books as Books { ID }
            order by Books.ID asc nulls first,
                     1 + 1 desc nulls last,
                     func() desc nulls first
    `
    expect(cqn4sql(original, model)).to.deep.equal(
      cds.ql`
      SELECT from bookshop.Books as Books { Books.ID }
        order by Books.ID asc nulls first,
                 1 + 1 desc nulls last,
                 func() desc nulls first
     `,
    )
  })
  it('`sort` and `nulls` are passed along also to flat field in order by', () => {
    const original = cds.ql`SELECT from bookshop.Books as Books { ID } order by Books.dedication.sub asc nulls first`
    expect(cqn4sql(original, model)).to.deep.equal(
      cds.ql`
      SELECT from bookshop.Books as Books { Books.ID }
        order by Books.dedication_sub_foo asc nulls first
     `,
    )
  })
  it('preserves cast property on column', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Bar as Bar {
            ID as castedID: cds.String
          }`,
      model,
    )
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Bar as Bar {
            Bar.ID as castedID: cds.String
          }`)
  })
  // a sql renderer will most likely just wrap the whole column into "cast(`col` as `type`)"
  // --> the implicit alias for that column would therefore equal the name of the cast function
  //     hence we should make the alias explicit for the cds style cast
  it('adds explicit alias for cast property on column', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Bar as Bar {
            ID: cds.String
          }`,
      model,
    )
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Bar as Bar {
            Bar.ID as ID: cds.String
          }`)
  })
  it('handles infix filter at entity and WHERE clause', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books[price < 12.13 or true] as Books {Books.ID} where stock < 11`, model)
    expect(query).to.deep.equal(
      cds.ql`SELECT from bookshop.Books as Books {Books.ID} WHERE (Books.price < 12.13 or true) and Books.stock < 11`,
    )
  })

  //(SMW) TODO I'd prefer to have the cond from the filter before the cond coming from the WHERE
  // which, by the way, is the case in tests below where we have a path in FROM -> ???
  it('gets precedence right for infix filter at entity and WHERE clause', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Books[price < 12.13 or stock > 77] as Books {Books.ID} where stock < 11 or price > 17.89`,
      model,
    )
    expect(query).to.deep.equal(
      cds.ql`SELECT from bookshop.Books as Books {Books.ID} WHERE (Books.price < 12.13 or Books.stock > 77) and (Books.stock < 11 or Books.price > 17.89)`,
    )
    //expect (query) .to.deep.equal (cds.ql`SELECT from bookshop.Books as Books {Books.ID} WHERE (Books.price < 12.13 or Books.stock > 77) and (Books.stock < 11 or Books.price > 17.89)`)  // (SMW) want this
  })

  it('handles infix filter with nested xpr at entity and WHERE clause', () => {
    let query = cqn4sql(
      cds.ql`
        SELECT from bookshop.Books[not (price < 12.13)] as Books { Books.ID } where stock < 11
        `,
      model,
    )
    expect(query).to.deep.equal(
      cds.ql`SELECT from bookshop.Books as Books {Books.ID} WHERE not (Books.price < 12.13) and Books.stock < 11`,
    )
  })

  // TODO: Move
  it('MUST ... be possible to address fully qualified, partial key in infix filter', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Orders.items[pos=2] {pos}`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Orders.items as $i {$i.pos} where $i.pos = 2`)
  })
})
