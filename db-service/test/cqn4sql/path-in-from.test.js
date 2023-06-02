'use strict'
const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds/lib')
const { expect } = cds.test
describe('infix filter on entities', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/srv/cat-service').then(cds.linked)
  })
  // (SMW) TODO: assoc path in FROM in subquery
  it('fail for infix filter at namespace', () => {
    // cds infer takes care of this
    expect(() => cqn4sql(CQL`SELECT from bookshop[Books.price < 12.13].Books`, model)).to.throw(
      /"bookshop" not found in the definitions of your model/,
    )
  })

  it('handles simple infix filter at entity', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Books[price < 12.13] {ID}`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books {Books.ID} WHERE Books.price < 12.13`)
  })

  it('handles multiple simple infix filters at entity', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Books[price < 12.13 or 12.14 < price] {ID}`, model)
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Books as Books {Books.ID} WHERE (Books.price < 12.13 or 12.14 < Books.price)`,
    )
  })

  it('fails when using table alias in infix filter at entity', () => {
    expect(() => cqn4sql(CQL`SELECT from bookshop.Books[Books.price < 12.13] {ID}`, model)).to.throw(
      /"Books" not found in the elements of "bookshop.Books"/,
    )
  })

  it('handles infix filter with struct access at entity', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Books[dedication.text = 'foo'] {Books.ID}`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books {Books.ID} WHERE Books.dedication_text = 'foo'`)
  })

  // TODO belongs to flattening
  it('handles infix filter at entity with association if it accesses FK', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Books[author.ID = 22] {Books.ID}`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books {Books.ID} WHERE Books.author_ID = 22`)
  })
})
