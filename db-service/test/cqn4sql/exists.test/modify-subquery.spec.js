'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('(exist predicate) modify auto-generated subquery', () => {
  before(async () => {
    const m = await loadModel()
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, m)
  })

  describe('in where', () => {
    it('with where / group by / having / order by / limit', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors
        {
          name
        }
        where exists books[1=1 group by author.ID having count(*) > 5 order by 5 desc limit 10]`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as $A
        {
          $A.name
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
          where $b.author_ID = $A.ID
            and 1 = 1
          group by $b.author_ID
          having count(*) > 5
          order by 5 desc
          limit 10
        )`

      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('scoped query', () => {
    it('with where / group by / having / order by / limit', () => {
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

  describe('in case expression', () => {
    it('with where / group by / having / order by / limit', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          ID,
          case when exists books[1=1 group by author.ID having count(*) > 10 order by 10 desc limit 10] then 1
               when exists books[1=1 group by author.ID having count(*) > 5 order by 5 desc limit 5] then 2
          end as descr
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          Authors.ID,
          case 
            when exists (
              select 1 from bookshop.Books as $b
              where $b.author_ID = Authors.ID 
                and 1 = 1
              group by $b.author_ID
              having count(*) > 10
              order by 10 desc
              limit 10
            )
            then 1
            when exists (
              select 1 from bookshop.Books as $b2
              where $b2.author_ID = Authors.ID
                and 1 = 1
              group by $b2.author_ID
              having count(*) > 5
              order by 5 desc
              limit 5
            )
            then 2
          end as descr
        }`

      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('in having', () => {
    it('with where / group by / having / order by / limit', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors
        {
          ID
        }
        group by ID
        having exists books[1=1 group by author.ID having count(*) > 2 order by 2 desc limit 3]`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as $A
        {
          $A.ID
        }
        group by $A.ID
        having exists (
          select 1 from bookshop.Books as $b
          where $b.author_ID = $A.ID
            and 1 = 1
          group by $b.author_ID
          having count(*) > 2
          order by 2 desc
          limit 3
        )`

      expectCqn(transformed).to.equal(expected)
    })
  })
})
