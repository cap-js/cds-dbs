'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn, expect } = require('../helpers/expectCqn')
const freezeData = require('../helpers/freezeData')

let cqn4sql = require('../../../lib/cqn4sql')

describe('calculated elements in draft enabled entities', () => {
  before(async () => {
    const model = freezeData(await loadModel({ flat: true }, [__dirname + '/../../bookshop/srv/calc-elem-service']))
    const orig = cqn4sql
    cqn4sql = (q, m) => orig(freezeData(q), m ?? model)
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

  for (const columns of ['ID, amount, plannedDuration, approvalType, nextValue', '*']) {
    it('unfolds virtual draft calculations in ' + columns, () => {
      const input = cds.ql(`SELECT from CalcService.DraftCalculations.drafts as D { ${columns} }
        excluding { IsActiveEntity, HasActiveEntity, HasDraftEntity, DraftAdministrativeData,
          DraftAdministrativeData_DraftUUID, SiblingEntity }`)
      const expected = cds.ql`SELECT from CalcService.DraftCalculations.drafts as D {
        D.ID, D.amount, null as plannedDuration, 3 as approvalType, D.amount + 1 as nextValue
      }`
      expectCqn(cqn4sql(input)).to.equal(expected)
    })
  }
})
