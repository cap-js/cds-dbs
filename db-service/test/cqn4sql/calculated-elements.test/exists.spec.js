'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('calculated elements with exists accessed through association', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql
    cqn4sql = (q, m) => orig(q, m ?? model)
  })

  it('accessing parent calc element with exists through association produces correct JOIN', () => {
    const transformed = cqn4sql(cds.ql`SELECT from existsInCalcElement.Tasks as Tasks { ID, isUserNotMember }`)
    const expected = cds.ql`
      SELECT from existsInCalcElement.Tasks as Tasks
      left join existsInCalcElement.Projects as project on project.ID = Tasks.project_ID
      {
        Tasks.ID,
        (case when (case when not exists (
          SELECT 1 from existsInCalcElement.Members as $m
            where $m.project_ID = project.ID
            and $m.userID = $user.id
        ) then true else false end) = true then true else false end) as isUserNotMember
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('parent calc element with exists directly on entity needs no JOIN', () => {
    const transformed = cqn4sql(cds.ql`SELECT from existsInCalcElement.Projects as Projects { ID, isUserNotMember }`)
    const expected = cds.ql`
      SELECT from existsInCalcElement.Projects as Projects
      {
        Projects.ID,
        (case when not exists (
          SELECT 1 from existsInCalcElement.Members as $m
            where $m.project_ID = Projects.ID
            and $m.userID = $user.id
        ) then true else false end) as isUserNotMember
      }`
    expectCqn(transformed).to.equal(expected)
  })
})
