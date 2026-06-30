'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('table alias access - in columns', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql
    cqn4sql = q => orig(q, model)
  })

  it('makes implicit table alias explicit and uses it for access', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books { ID }`)
    const expected = cds.ql`SELECT from bookshop.Books as $B { $B.ID }`
    expectCqn(transformed).to.equal(expected)
  })

  it('creates unique alias for anonymous query which selects from other query', () => {
    const transformed = cqn4sql(cds.ql`SELECT from (SELECT from bookshop.Books { ID } )`)
    const expected = cds.ql`SELECT from (SELECT from bookshop.Books as $B { $B.ID }) as __select__ { __select__.ID }`
    expectCqn(transformed).to.equal(expected)
  })

  it('the unique alias for anonymous query does not collide with user provided aliases', () => {
    const transformed = cqn4sql(cds.ql`SELECT from (SELECT from bookshop.Books as __select__ { ID } )`)
    const expected = cds.ql`SELECT from (SELECT from bookshop.Books as __select__ { __select__.ID }) as __select__2 { __select__2.ID }`
    expectCqn(transformed).to.equal(expected)
  })

  it('the unique alias for anonymous query does not collide with user provided aliases in case of joins', () => {
    const transformed = cqn4sql(
      cds.ql`SELECT from (SELECT from bookshop.Books as __select__ { ID, author } ) { author.name }`,
    )
    const expected = cds.ql`
    SELECT from (
      SELECT from bookshop.Books as __select__ { __select__.ID, __select__.author_ID }
    ) as __select__2 left join bookshop.Authors as author on author.ID = __select__2.author_ID
    {
      author.name as author_name
    }`
    expectCqn(transformed).to.equal(expected)
  })

  it('the unique alias for anonymous query does not collide with user provided aliases nested', () => {
    // author association bubbles up to the top query where the join finally is done
    // --> note that the most outer query uses user defined __select__ alias
    const transformed = cqn4sql(
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
    const expected = cds.ql`
    SELECT from (
      SELECT from (
        SELECT from bookshop.Books as Books { Books.ID, Books.author_ID }
        ) as __select__2 { __select__2.ID, __select__2.author_ID }
    ) as __select__ left join bookshop.Authors as author on author.ID = __select__.author_ID
    {
      author.name as author_name
    }`
    expectCqn(transformed).to.equal(expected)
  })

  it('preserves table alias at field access', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { Books.ID }`)
    const expected = cds.ql`SELECT from bookshop.Books as Books { Books.ID }`
    expectCqn(transformed).to.equal(expected)
  })

  it('handles field access with and without table alias', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID, Books.stock }`)
    const expected = cds.ql`SELECT from bookshop.Books as Books { Books.ID, Books.stock }`
    expectCqn(transformed).to.equal(expected)
  })

  it('supports user defined table alias', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as A { A.ID, stock }`)
    const expected = cds.ql`SELECT from bookshop.Books as A { A.ID, A.stock }`
    expectCqn(transformed).to.equal(expected)
  })

  it('user defined table alias equals field name', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as stock { stock.ID, stock, stock.stock as s2 }`)
    const expected = cds.ql`SELECT from bookshop.Books as stock { stock.ID, stock.stock, stock.stock as s2 }`
    expectCqn(transformed).to.equal(expected)
  })

  it('supports scoped entity names', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books.twin as twin { ID }`)
    const expected = cds.ql`SELECT from bookshop.Books.twin as twin { twin.ID }`
    expectCqn(transformed).to.equal(expected)
  })
})
