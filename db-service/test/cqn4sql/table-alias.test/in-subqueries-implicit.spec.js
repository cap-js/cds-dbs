'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expect } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('table alias access - replace usage of implicit aliases in subqueries', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql
    cqn4sql = q => orig(q, model)
  })

  it('in columns', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Books {
                ID,
                (
                  SELECT from bookshop.Books {
                    $B.ID,
                  } where $B.ID = 1
                ) as sub
              } where $B.ID = 1
              `,
    )
    expect(query).to.deep.equal(
      cds.ql`SELECT from bookshop.Books as $B {
            $B.ID,
            (
              SELECT from bookshop.Books as $B2 {
                $B2.ID,
              } where $B2.ID = 1
            ) as sub
          } where $B.ID = 1`,
    )
  })
  it('in a scoped subquery, always assign unique subquery aliases', () => {
    const query = cds.ql`SELECT ID from bookshop.Item where exists (select ID from bookshop.Item:Item)`
    const res = cqn4sql(query)
    const expected = cds.ql`
    SELECT $I.ID from bookshop.Item as $I where exists (
      SELECT $I2.ID from bookshop.Item as $I2 where exists (
        SELECT 1 from bookshop.Item as $I3 where $I3.Item_ID = $I2.ID
      )
    )
    `
    expect(res).to.deep.eql(expected)
  })
  it('in expand subquery', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Books {
                ID,
                (
                  SELECT from bookshop.Books {
                    $B.ID,
                    $B.author {
                      name
                    },
                  } where $B.author.dateOfBirth >= '01-01-1969'
                ) as sub
              } where $B.ID = 1
              `,
    )
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(
      cds.ql`SELECT from bookshop.Books as $B {
            $B.ID,
            (
              SELECT from bookshop.Books as $B2
                left join bookshop.Authors as author on author.ID = $B2.author_ID
              {
                $B2.ID,
                (
                  SELECT $a.name from bookshop.Authors as $a where $B2.author_ID = $a.ID
                ) as author
              } where author.dateOfBirth >= '01-01-1969'
            ) as sub
          } where $B.ID = 1`,
    )
  })
  it('in join relevant columns', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Books {
                ID,
                (
                  SELECT from bookshop.Books {
                    $B.ID,
                    $B.author.name,
                  } where $B.author.dateOfBirth >= '01-01-1969'
                ) as sub
              } where $B.ID = 1
              `,
    )
    expect(query).to.deep.equal(
      cds.ql`SELECT from bookshop.Books as $B {
            $B.ID,
            (
              SELECT from bookshop.Books as $B2
                left join bookshop.Authors as author on author.ID = $B2.author_ID
              {
                $B2.ID,
                author.name as author_name,
              } where author.dateOfBirth >= '01-01-1969'
            ) as sub
          } where $B.ID = 1`,
    )
  })
  it('in group by and order by', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Books {
                ID,
                (
                  SELECT from bookshop.Books {
                    $B.ID,
                  }
                  group by $B.title
                  order by $B.ID
                ) as sub
              } where $B.ID = 1
              `,
    )
    expect(query).to.deep.equal(
      cds.ql`SELECT from bookshop.Books as $B {
            $B.ID,
            (
              SELECT from bookshop.Books as $B2 {
                $B2.ID,
              }
              group by $B2.title
              order by $B2.ID
            ) as sub
          } where $B.ID = 1`,
    )
  })
})
