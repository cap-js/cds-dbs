'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn, expect } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('Unfolding calculated elements and localized', () => {
  before(async () => {
    cds.model = await loadModel({}, [__dirname + '/../../bookshop/db/booksWithExpr'])
    const model = cds.compile.for.nodejs(cds.model)
    const orig = cqn4sql
    cqn4sql = (q, m) => orig(q, m ?? model)
  })

  it('presence of localized element should not affect unfolding', () => {
    const q = cds.ql`SELECT from booksCalc.LBooks as LBooks { ID, title, area }`
    q.SELECT.localized = true
    const transformed = cqn4sql(q)
    const expected = cds.ql`SELECT from localized.booksCalc.LBooks as LBooks {
        LBooks.ID,
        LBooks.title,
        LBooks.length * LBooks.width as area
      }`
    expectCqn(transformed).to.equal(expected)
    expect(transformed.SELECT.localized).to.be.true
  })

  it('calculated element refers to localized element', () => {
    const q = cds.ql`SELECT from booksCalc.LBooks as LBooks { ID, title, ctitle }`
    q.SELECT.localized = true
    const transformed = cqn4sql(q)
    const expected = cds.ql`SELECT from localized.booksCalc.LBooks as LBooks {
        LBooks.ID,
        LBooks.title,
        substring(LBooks.title, 3, 3) as ctitle
      }`
    expectCqn(transformed).to.equal(expected)
    expect(transformed.SELECT.localized).to.be.true
  })

  it('calc elements with sub selects', () => {
    const q = cds.ql`SELECT ID, area from (SELECT ID, area from booksCalc.Books)`
    const transformed = cqn4sql(q)
    const expected = cds.ql`
      SELECT __select__.ID, __select__.area from (
          SELECT FROM booksCalc.Books as $B {
            $B.ID,
            $B.length * $B.width as area
          }
      ) AS __select__`
    expectCqn(transformed).to.equal(expected)
  })

  it('calc elements with intermediate sub select star', () => {
    const q = cds.ql`SELECT ID, area from (SELECT * FROM (SELECT ID, area from booksCalc.Books))`
    const transformed = cqn4sql(q)
    const expected = cds.ql`
      SELECT __select__2.ID, __select__2.area from (
        SELECT __select__.ID, __select__.area FROM (
          SELECT FROM booksCalc.Books as $B {
            $B.ID,
            $B.length * $B.width as area
          }
        ) as __select__
      ) AS __select__2`
    expectCqn(transformed).to.equal(expected)
  })
})
