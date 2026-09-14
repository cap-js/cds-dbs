'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn, expect } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('calculated elements in draft enabled entities', () => {
  before(async () => {
    const model = await loadModel({ flat: true }, [__dirname + '/../../bookshop/srv/calc-elem-service'])
    const orig = cqn4sql
    cqn4sql = (q, m) => orig(q, m ?? model)
  })

  it('keeps param: false for query against active entries', () => {
    const transformed = cqn4sql(cds.ql`SELECT from CalcService.Orders as Orders { ID, expensive }`)
    const expected = cds.ql`SELECT from CalcService.Orders as Orders {
      Orders.ID,
      case when Orders.amount > 10 then 1 else 0 end as expensive
    }`
    expectCqn(transformed).to.equal(expected)
    expect(transformed.SELECT.columns[1].xpr[4].param).to.be.false
    expect(transformed.SELECT.columns[1].xpr[6].param).to.be.false
    expect(transformed.SELECT.columns[1].xpr[8].param).to.be.false
  })

  it('keeps param: false for query against draft entries', () => {
    const transformed = cqn4sql(cds.ql`SELECT from CalcService.Orders.drafts as Orders { ID, expensive }`)
    const expected = cds.ql`SELECT from CalcService.Orders.drafts as Orders {
      Orders.ID,
      case when Orders.amount > 10 then 1 else 0 end as expensive
    }`
    expectCqn(transformed).to.equal(expected)
    expect(transformed.SELECT.columns[1].xpr[4].param).to.be.false
    expect(transformed.SELECT.columns[1].xpr[6].param).to.be.false
    expect(transformed.SELECT.columns[1].xpr[8].param).to.be.false
  })
})
