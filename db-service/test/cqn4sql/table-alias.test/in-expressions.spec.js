'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expect } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('table alias access - in expressions', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql
    cqn4sql = q => orig(q, model)
  })

  it('expressions and functions in select list', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Books {
          stock * price as foo,
          power(price, stock) as bar,
          stock * power(sin(2*price),
          2*(stock+3*stock)) as nested,
          2 as two
        }`,
    )
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as $B {
          $B.stock * $B.price as foo,
          power($B.price, $B.stock) as bar,
          $B.stock * power(sin(2*$B.price), 2*($B.stock+3*$B.stock)) as nested,
          2 as two
        }`)
  })

  it('expressions and functions in WHERE', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Books { ID }
          where stock * price < power(price, stock) or stock * power(sin(2*price), 2*(stock+3*stock)) < 7`,
    )
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as $B { $B.ID }
          where $B.stock * $B.price < power($B.price, $B.stock) or $B.stock * power(sin(2*$B.price), 2*($B.stock+3*$B.stock)) < 7`)
  })

  it('expressions and functions in GROUP BY/HAVING', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Books { ID }
          group by stock * price, power(price, stock), stock * power(sin(2*price), 2*(stock+3*stock))
          having stock * price < power(price, stock) or stock * power(sin(2*price), 2*(stock+3*stock)) < 7`,
    )
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as $B { $B.ID }
          group by $B.stock * $B.price, power($B.price, $B.stock), $B.stock * power(sin(2*$B.price), 2*($B.stock+3*$B.stock))
          having $B.stock * $B.price < power($B.price, $B.stock) or $B.stock * power(sin(2*$B.price), 2*($B.stock+3*$B.stock)) < 7`)
  })
})
