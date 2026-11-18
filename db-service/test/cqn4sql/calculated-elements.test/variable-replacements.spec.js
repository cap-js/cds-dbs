'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('Unfolding calculated elements - variable replacements ($now, $user)', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql
    cqn4sql = (q, m) => orig(q, m ?? model)
  })

  it('variable replacements are left untouched in calc element navigation', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.VariableReplacements as VariableReplacements { ID, authorAlive.firstName }`)
    const expected = cds.ql`
      SELECT from booksCalc.VariableReplacements as VariableReplacements
      left join booksCalc.Authors as authorAlive on ( authorAlive.ID = VariableReplacements.author_ID )
      and ( authorAlive.dateOfBirth <= $now and authorAlive.dateOfDeath >= $now and $user.unknown.foo.bar = 'Bob' )
      {
        VariableReplacements.ID,
        authorAlive.firstName as authorAlive_firstName
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('variable replacements are left untouched in calc elements via wildcard', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.VariableReplacements as VariableReplacements { * }`)
    const expected = cds.ql`
      SELECT from booksCalc.VariableReplacements as VariableReplacements
      {
        VariableReplacements.ID,
        VariableReplacements.author_ID
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('with expand', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.VariableReplacements as VariableReplacements { ID, authorAlive { ID }  }`)
    const expected = cds.ql`
      SELECT from booksCalc.VariableReplacements as VariableReplacements {
        VariableReplacements.ID,
        (
          SELECT from booksCalc.Authors as $a
          {
            $a.ID,
          }
          where ($a.ID = VariableReplacements.author_ID)
          and ( $a.dateOfBirth <= $now and $a.dateOfDeath >= $now and $user.unknown.foo.bar = 'Bob' )
        ) as authorAlive
      }`
    expectCqn(transformed).to.equal(expected)
  })
})
