'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn, expect } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('Unfolding calculated elements - exists', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql
    cqn4sql = (q, m) => orig(q, m ?? model)
  })

  it('exists cannot leverage calculated elements which ends in string', () => {
    // at the leaf of a where exists path, there must be an association
    expect(() => cqn4sql(cds.ql`SELECT from booksCalc.Books { ID } where exists youngAuthorName`)).to.throw(
      `Expecting path “youngAuthorName” following “EXISTS” predicate to end with association/composition, found “cds.String”`,
    )
  })

  it('exists cannot leverage calculated elements which is an expression', () => {
    // at the leaf of a where exists path, there must be an association
    expect(() => cqn4sql(cds.ql`SELECT from booksCalc.Books { ID } where exists authorFullName`)).to.throw(
      `Expecting path “authorFullName” following “EXISTS” predicate to end with association/composition, found “expression”`,
    )
  })

  it('exists cannot leverage calculated elements w/ path expressions', () => {
    // at the leaf of a where exists path, there must be an association
    expect(() =>
      cqn4sql(cds.ql`SELECT from booksCalc.Books { ID } where exists author.books.youngAuthorName`),
    ).to.throw('Expecting path “author.books.youngAuthorName” following “EXISTS” predicate to end with association/composition, found “cds.String”')
  })

  it('exists cannot leverage calculated elements in CASE', () => {
    expect(() =>
      cqn4sql(cds.ql`SELECT from booksCalc.Books {
        ID,
        case when exists youngAuthorName then 'yes'
             else 'no'
        end as x
      }`),
    ).to.throw('Expecting path “youngAuthorName” following “EXISTS” predicate to end with association/composition, found “cds.String”')
  })

  it('scoped query cannot leverage calculated elements', () => {
    // at the leaf of a where exists path, there must be an association
    expect(() => cqn4sql(cds.ql`SELECT from booksCalc.Books:youngAuthorName { ID }`)).to.throw(
      'Query source must be a an entity or an association',
    )
  })

  describe('calculated elements with exists accessed through association', () => {
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
})
