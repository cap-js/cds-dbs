'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('Unfolding calculated elements - basics', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql
    cqn4sql = (q, m) => orig(q, m ?? model)
  })

  it('simple reference', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, stock2 }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books {
        Books.ID,
        Books.stock as stock2
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('simple val', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Authors as Authors { ID, IBAN }`)
    const expected = cds.ql`
      SELECT from booksCalc.Authors as Authors {
        Authors.ID,
        'DE' || Authors.checksum || Authors.sortCode || Authors.accountNumber as IBAN
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('directly', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, area }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books {
        Books.ID,
        Books.length * Books.width as area
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('in expression', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, stock * area as f }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books {
        Books.ID,
        Books.stock * ( Books.length * Books.width ) as f
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('in function', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, round(area, 2) as f }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books {
        Books.ID,
        round(Books.length * Books.width, 2) as f
      }`
    expectCqn(transformed).to.equal(expected)
  })
})
