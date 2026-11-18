'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('Unfolding calculated elements - ternary / CASE', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql
    cqn4sql = (q, m) => orig(q, m ?? model)
  })

  it('in ternary', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Ternary as Ternary { ID, nestedTernary }`)
    const expected = cds.ql`
      SELECT from booksCalc.Ternary as Ternary
      left join booksCalc.Books as book on book.ID = Ternary.book_ID
      {
        Ternary.ID,
        (case when 1 > 0 then 1 else (case when book.stock > 10 then Ternary.value else 3 end) end) as nestedTernary
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('calcualted element in nested ternary', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Ternary as Ternary { ID, calculatedElementInNestedTernary }`)
    const expected = cds.ql`
      SELECT from booksCalc.Ternary as Ternary
      left join booksCalc.Books as book on book.ID = Ternary.book_ID
      left join booksCalc.Authors as author on author.ID = book.author_ID
      {
        Ternary.ID,
        (case when 1 > 0 then 1 else (case when book.stock > (case when 1 > 0 then 1 else (case when book.stock > years_between(author.dateOfBirth, author.dateOfDeath) then Ternary.value else 3 end) end) then Ternary.value else 3 end) end) as calculatedElementInNestedTernary
      }`
    //                                                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    expectCqn(transformed).to.equal(expected)
  })

  it('list in ternary', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Ternary as Ternary { ID, nestedTernaryWithNestedXpr }`)
    const expected = cds.ql`
      SELECT from booksCalc.Ternary as Ternary
      left join booksCalc.Books as book on book.ID = Ternary.book_ID
      {
        Ternary.ID,
        (case when 1 > 0 then 1 else (case when ( (10 + book.stock) in (1, 2, 3, 4) ) then Ternary.value else 3 end) end) as nestedTernaryWithNestedXpr
      }`
    expectCqn(transformed).to.equal(expected)
  })
})
