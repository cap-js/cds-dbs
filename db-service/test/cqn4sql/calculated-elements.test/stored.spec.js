'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('Stored (on-write) calculated elements', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql
    cqn4sql = (q, m) => orig(q, m ?? model)
  })

  it('calculated element on-write (stored) is not unfolded', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, areaS }`)
    const expected = cds.ql`SELECT from booksCalc.Books as Books { Books.ID, Books.areaS }`
    expectCqn(transformed).to.equal(expected)
  })
})
