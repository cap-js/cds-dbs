'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('table alias access - implicit aliasing', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql
    cqn4sql = q => orig(q, model)
  })

  it('can handle entities beginning with $', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.![$special] { ID }`)
    const expected = cds.ql`SELECT from bookshop.$special as $s { $s.ID }`
    expectCqn(transformed).to.equal(expected)
  })
  // TODO: also use technical alias for join nodes
  it('can handle entities beginning with $ and joins for assocs starting with $', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.![$special] { ID, ![$special].name }`)
    const expected = cds.ql`SELECT from bookshop.$special as $s left join bookshop.$special as $special on $special.ID = $s.$special_ID
    {
      $s.ID,
      $special.name as $special_name
    }`
    expectCqn(transformed).to.equal(expected)
  })
  it('can handle scoped queries via navigations starting with $', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.$special:$special { ID }`)
    const expected = cds.ql`
    SELECT from bookshop.$special as $s { $s.ID }
    where exists (SELECT 1 from bookshop.$special as $s2 where $s2.$special_ID = $s.ID)
    `
    expectCqn(transformed).to.equal(expected)
  })
  it('can handle expand queries via navigations starting with $', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.$special { ID, $special { name } }`)
    const expected = cds.ql`
    SELECT from bookshop.$special as $s {
      $s.ID,
      (SELECT $s2.name from bookshop.$special as $s2 where $s.$special_ID = $s2.ID) as $special
    }
    `
    expectCqn(transformed).to.equal(expected)
  })

  // entity called "$" with association called "$" to entity called "$"
  it('can handle entities beginning with $', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.$ { ID }`)
    const expected = cds.ql`SELECT from bookshop.$ as $$ { $$.ID }`
    expectCqn(transformed).to.equal(expected)
  })

  // TODO: also use technical alias for join nodes
  it('can handle entities called $ and joins for assocs called $', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.$ { ID, $.name }`)
    const expected = cds.ql`SELECT from bookshop.$ as $$ left join bookshop.$ as $ on $.ID = $$.$_ID
    {
      $$.ID,
      $.name as $_name
    }`
    expectCqn(transformed).to.equal(expected)
  })

  it('can handle scoped queries via navigations called $', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.$:$ { ID }`)
    const expected = cds.ql`
    SELECT from bookshop.$ as $$ { $$.ID }
    where exists (SELECT 1 from bookshop.$ as $$2 where $$2.$_ID = $$.ID)
    `
    expectCqn(transformed).to.equal(expected)
  })

  it('can handle expand queries via navigations called $', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.$ { ID, $ { name } }`)
    const expected = cds.ql`
    SELECT from bookshop.$ as $$ {
      $$.ID,
      (SELECT $$2.name from bookshop.$ as $$2 where $$.$_ID = $$2.ID) as $
    }
    `
    expectCqn(transformed).to.equal(expected)
  })
})
