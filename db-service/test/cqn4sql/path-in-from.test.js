'use strict'
const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds')
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
      /"Books" not found in "bookshop.Books"/,
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
  it('handles query modifiers defined in infix filter at leaf', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Books[
        price < 12.13
        group by title
        having title
        order by title desc
        limit 2
      ] {ID}`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books {Books.ID} WHERE Books.price < 12.13 GROUP BY Books.title HAVING Books.title ORDER BY Books.title DESC LIMIT 2`)
  });
  it('merges query modifiers defined in infix filter at leaf with those defined at query root', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Books[
        price < 12.13
        group by title
        having title
        order by title desc
        limit 2
      ] {ID} where price > 5 group by price having price order by price limit 5`, model)
    expect(query).to.deep.equal(
      cds.ql`SELECT from bookshop.Books as Books {Books.ID}
            WHERE (Books.price > 5) and (Books.price < 12.13)
            GROUP BY Books.price, Books.title
            HAVING Books.price and Books.title
            ORDER BY Books.price, Books.title DESC
            LIMIT 5`)
  });

  it('handles query modifiers (where only) along the ref of a scoped query', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books[where title = 'bar']:author[group by name] {ID}`, model)
    const expected = cds.ql`
      SELECT from bookshop.Authors as author {author.ID} where exists (
        SELECT 1 from bookshop.Books as Books WHERE Books.author_ID = author.ID and Books.title = 'bar'
      ) GROUP BY author.name
    `
    expect(query).to.deep.equal(expected)
  });
})
