'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('./helpers/model')
const { expectCqn, expect } = require('./helpers/expectCqn')

let cqn4sql = require('../../lib/cqn4sql')

describe('enums', () => {
  before(async () => {
    const m = await loadModel({}, __dirname + '/model/enums')
    const orig = cqn4sql
    cqn4sql = q => orig(q, m)
  })

  describe('in where clause', () => {
    it('resolves string enum in comparison', () => {
      const q = cds.ql`SELECT from enums.Orders as Orders { Orders.id } where Orders.status = #open`
      const expected = cds.ql`SELECT from enums.Orders as Orders { Orders.id } where Orders.status = 'O'`
      expectCqn(cqn4sql(q)).to.equal(expected)
    })

    it('resolves integer enum in comparison', () => {
      const q = cds.ql`SELECT from enums.Orders as Orders { Orders.id } where Orders.priority = #high`
      const expected = cds.ql`SELECT from enums.Orders as Orders { Orders.id } where Orders.priority = 3`
      expectCqn(cqn4sql(q)).to.equal(expected)
    })

    it('resolves enum on left-hand side of comparison', () => {
      const q = cds.ql`SELECT from enums.Orders as Orders { Orders.id } where #low = Orders.priority`
      const expected = cds.ql`SELECT from enums.Orders as Orders { Orders.id } where 1 = Orders.priority`
      expectCqn(cqn4sql(q)).to.equal(expected)
    })

    it('resolves string enum where symbol name equals value', () => {
      const q = cds.ql`SELECT from enums.Orders as Orders { Orders.id } where Orders.category = #book`
      const expected = cds.ql`SELECT from enums.Orders as Orders { Orders.id } where Orders.category = 'book'`
      expectCqn(cqn4sql(q)).to.equal(expected)
    })

    it('resolves multiple enums in logical expression', () => {
      const q = cds.ql`SELECT from enums.Orders as Orders { Orders.id }
        where Orders.priority = #low and Orders.status = #closed`
      const expected = cds.ql`SELECT from enums.Orders as Orders { Orders.id }
        where Orders.priority = 1 and Orders.status = 'C'`
      expectCqn(cqn4sql(q)).to.equal(expected)
    })

    it('resolves enum with != operator', () => {
      const q = cds.ql`SELECT from enums.Orders as Orders { Orders.id } where Orders.priority != #critical`
      const expected = cds.ql`SELECT from enums.Orders as Orders { Orders.id } where Orders.priority != 4`
      expectCqn(cqn4sql(q)).to.equal(expected)
    })
  })

  describe('in lists', () => {
    it('resolves enums in IN list', () => {
      const q = cds.ql`SELECT from enums.Orders as Orders { Orders.id }
        where Orders.priority in (#low, #medium, #high)`
      const expected = cds.ql`SELECT from enums.Orders as Orders { Orders.id }
        where Orders.priority in (1, 2, 3)`
      expectCqn(cqn4sql(q)).to.equal(expected)
    })

    it('resolves string enums in IN list', () => {
      const q = cds.ql`SELECT from enums.Orders as Orders { Orders.id }
        where Orders.status in (#open, #closed)`
      const expected = cds.ql`SELECT from enums.Orders as Orders { Orders.id }
        where Orders.status in ('O', 'C')`
      expectCqn(cqn4sql(q)).to.equal(expected)
    })
  })

  describe('in case expressions', () => {
    it('resolves enums in case when discriminant', () => {
      const q = cds.ql`SELECT from enums.Orders as Orders {
        Orders.id,
        case Orders.priority
          when #low then 'Low'
          when #medium then 'Medium'
          else 'High'
        end as label
      }`
      const expected = cds.ql`SELECT from enums.Orders as Orders {
        Orders.id,
        case Orders.priority
          when 1 then 'Low'
          when 2 then 'Medium'
          else 'High'
        end as label
      }`
      expectCqn(cqn4sql(q)).to.equal(expected)
    })

    it('resolves enums in case when condition', () => {
      const q = cds.ql`SELECT from enums.Orders as Orders {
        Orders.id,
        case when Orders.priority = #low then 'Low'
             when Orders.priority = #high then 'High'
             else 'Other'
        end as label
      }`
      const expected = cds.ql`SELECT from enums.Orders as Orders {
        Orders.id,
        case when Orders.priority = 1 then 'Low'
             when Orders.priority = 3 then 'High'
             else 'Other'
        end as label
      }`
      expectCqn(cqn4sql(q)).to.equal(expected)
    })
  })

  describe('already resolved', () => {
    it('passes through enum token with val already set', () => {
      // Simulates CSN from compiler where val is already resolved
      const q = {
        SELECT: {
          from: { ref: ['enums.Orders'] },
          columns: [{ ref: ['id'] }],
          where: [{ ref: ['status'] }, '=', { '#': 'open', val: 'O' }],
        },
      }
      const result = cqn4sql(q)
      // The value should be preserved
      expect(result.SELECT.where[2]).to.deep.equal({ val: 'O' })
    })
  })

  describe('error cases', () => {
    it('throws for unresolvable enum reference', () => {
      // No adjacent ref with an enum type to look up the symbol in
      const q = cds.ql`SELECT from enums.Orders as Orders { Orders.id } where #unknown = 1`
      expect(() => cqn4sql(q)).to.throw(/Can't resolve enum value/)
    })

    it('throws for unknown enum symbol', () => {
      // Context ref found (Orders.priority has enum type) but symbol doesn't exist in it
      const q = cds.ql`SELECT from enums.Orders as Orders { Orders.id } where Orders.priority = #nonexistent`
      expect(() => cqn4sql(q)).to.throw(/Unknown enum symbol "#nonexistent"/)
    })
  })
})
