'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('(exist predicate) scoped queries', () => {
  before(async () => {
    const m = await loadModel()
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, m)
  })

  describe('simple', () => {})

  describe('with infix filter', () => {
    it('filter at leaf with OR needs to be put in brackets', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors:books[contains(title, 'Gravity') or contains(title, 'Dark')]
        {
          ID
        }`)
      // the above is syntactic sugar for the following
      const otherWayOfWritingFilter = cqn4sql(cds.ql`
        SELECT from bookshop.Authors:books
        {
          ID
        }
        WHERE contains(title, 'Gravity') or contains(title, 'Dark')`)
      const expected = cds.ql`
        SELECT from bookshop.Books as $b
        {
          $b.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Authors as $A
          WHERE $A.ID = $b.author_ID
        ) and (
           contains($b.title, 'Gravity') or contains($b.title, 'Dark')
        )`
      expectCqn(transformed).to.equal(otherWayOfWritingFilter).to.equal(expected)
    })
  })

  describe('modify subquery', () => {
    // TODO: FIX
    it.skip('with group by and having', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books[
          where 1 = 1
          group by author.ID
          having count(*) > 5
          order by 5 desc
          limit 10
          ]:author
        {
          name
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as $a
        {
          $a.name
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B
          WHERE $B.author_ID = $a.ID
            and 1 = 1
          group by $B.author_ID
          having count(*) > 5
          order by 5 desc
          limit 10
        )`

      expectCqn(transformed).to.equal(expected)
    })
  })
})
