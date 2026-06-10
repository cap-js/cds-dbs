'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expect } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('table alias access - in columns', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql
    cqn4sql = q => orig(q, model)
  })

  it('makes implicit table alias explicit and uses it for access', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books { ID }`)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as $B { $B.ID }`)
  })

  it('creates unique alias for anonymous query which selects from other query', () => {
    let query = cqn4sql(cds.ql`SELECT from (SELECT from bookshop.Books { ID } )`)
    expect(query).to.deep.equal(
      cds.ql`SELECT from (SELECT from bookshop.Books as $B { $B.ID }) as __select__ { __select__.ID }`,
    )
  })

  it('the unique alias for anonymous query does not collide with user provided aliases', () => {
    let query = cqn4sql(cds.ql`SELECT from (SELECT from bookshop.Books as __select__ { ID } )`)
    expect(query).to.deep.equal(
      cds.ql`SELECT from (SELECT from bookshop.Books as __select__ { __select__.ID }) as __select__2 { __select__2.ID }`,
    )
  })
  it('the unique alias for anonymous query does not collide with user provided aliases in case of joins', () => {
    let query = cqn4sql(
      cds.ql`SELECT from (SELECT from bookshop.Books as __select__ { ID, author } ) { author.name }`,
    )
    expect(query).to.deep.equal(cds.ql`
    SELECT from (
      SELECT from bookshop.Books as __select__ { __select__.ID, __select__.author_ID }
    ) as __select__2 left join bookshop.Authors as author on author.ID = __select__2.author_ID
    {
      author.name as author_name
    }`)
  })

  it('the unique alias for anonymous query does not collide with user provided aliases nested', () => {
    // author association bubbles up to the top query where the join finally is done
    // --> note that the most outer query uses user defined __select__ alias
    let query = cqn4sql(
      cds.ql`
    SELECT from (
      SELECT from (
        SELECT from bookshop.Books as Books { ID, author }
      )
    ) as __select__
    {
      __select__.author.name
    }`,
    )
    expect(query).to.deep.equal(
      cds.ql`
      SELECT from (
        SELECT from (
          SELECT from bookshop.Books as Books { Books.ID, Books.author_ID }
          ) as __select__2 { __select__2.ID, __select__2.author_ID }
      ) as __select__ left join bookshop.Authors as author on author.ID = __select__.author_ID
      {
        author.name as author_name
      }`,
    )
  })

  it('preserves table alias at field access', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { Books.ID }`)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books { Books.ID }`)
  })

  it('handles field access with and without table alias', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID, Books.stock }`)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books { Books.ID, Books.stock }`)
  })

  it('supports user defined table alias', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books as A { A.ID, stock }`)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as A { A.ID, A.stock }`)
  })

  it('user defined table alias equals field name', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books as stock { stock.ID, stock, stock.stock as s2 }`)
    expect(query).to.deep.equal(
      cds.ql`SELECT from bookshop.Books as stock { stock.ID, stock.stock, stock.stock as s2 }`,
    )
  })

  it('supports scoped entity names', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books.twin as twin { ID }`)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books.twin as twin { twin.ID }`)
  })
})
