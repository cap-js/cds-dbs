'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('(exist predicate) with joins', () => {
  before(async () => {
    const m = await loadModel()
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, m)
  })

  describe('inner join in exists subquery for path expressions in infix filter', () => {
    it('managed assoc within structure', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors
        {
          ID
        }
        WHERE EXISTS books[dedication.addressee.name = 'Hasso']`)
      const expected = cds.ql`
        SELECT from bookshop.Authors as $A
        {
          $A.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
            inner join bookshop.Person as addressee on addressee.ID = $b.dedication_addressee_ID
          WHERE $b.author_ID = $A.ID
            and addressee.name = 'Hasso'
        )`
      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('in where', () => {
    it('managed assoc after exists and in expression', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          ID
        }
        WHERE EXISTS author and ((author.name + 's') = 'Schillers')`)
      const expected = cds.ql`
        SELECT from bookshop.Books as $B
          left join bookshop.Authors as author on author.ID = $B.author_ID
        {
          $B.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Authors as $a
          WHERE $a.ID = $B.author_ID
        ) and ((author.name + 's') = 'Schillers')`
      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('scoped queries', () => {
    it('path in from and in columns', () => {
      const transformed = cqn4sql(cds.ql`
      SELECT from bookshop.Books:author as author
      {
        books.genre.name
      }`)
      const expected = cds.ql`
      SELECT from bookshop.Authors as author
        left outer join bookshop.Books as books on books.author_ID = author.ID
        left outer join bookshop.Genres as genre on genre.ID = books.genre_ID
      {
        genre.name as books_genre_name
      }
      where exists (
        SELECT 1 from bookshop.Books as $B
        WHERE $B.author_ID = author.ID
      )`
      expectCqn(transformed).to.equal(expected)
    })

    it('aliases for recursive assoc in column + recursive assoc in from must not clash', () => {
      const transformed = cqn4sql(cds.ql`
      SELECT from bookshop.Authors:books.genre.parent.parent.parent as parent
      {
        parent.parent.parent.descr
      }`)
      // Revisit: Alias count order in where + from could be flipped
      const expected = cds.ql`
      SELECT from bookshop.Genres as parent
        left outer join bookshop.Genres as parent2 on parent2.ID = parent.parent_ID
        left outer join bookshop.Genres as parent3 on parent3.ID = parent2.parent_ID
      {
        parent3.descr as parent_parent_descr
      }
      WHERE exists (
        SELECT 1 from bookshop.Genres as $p
        WHERE $p.parent_ID = parent.ID and exists (
          SELECT 1 from bookshop.Genres as $p2
          WHERE $p2.parent_ID = $p.ID and exists (
            SELECT 1 from bookshop.Genres as $g
            WHERE $g.parent_ID = $p2.ID and exists (
              SELECT 1 from bookshop.Books as $b
              WHERE $b.genre_ID = $g.ID and exists (
                SELECT 1 from bookshop.Authors as $A
                WHERE $A.ID = $b.author_ID
              )
            )
          )
        )
      )`
      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('with filter conditions', () => {
    it('in case', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          ID,
          case when exists books[price>10]  then books[stock=1].genre[code='A'].descr
               when exists books[price>100] then books[stock=1].genre[code='B' or code='C'].descr
          end as descr
        }`)
      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
          left outer join bookshop.Books as books on books.author_ID = Authors.ID
           and books.stock = 1
          left outer join bookshop.Genres as genre on genre.ID = books.genre_ID
           and genre.code = 'A'
          left outer join bookshop.Genres as genre2 on genre2.ID = books.genre_ID
           and (genre2.code = 'B' or genre2.code = 'C')
        {
          Authors.ID,
          case when exists (
                      select 1 from bookshop.Books as $b
                      WHERE $b.author_ID = Authors.ID and $b.price > 10
                    )
               then genre.descr
               when exists (
                      select 1 from bookshop.Books as $b2
                      WHERE $b2.author_ID = Authors.ID and $b2.price > 100
                    )
               then genre2.descr
          end as descr
        }`
      expectCqn(transformed).to.equal(expected)
    })
    it('predicate inside infix filter - exists also has filter', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          ID,
          books[exists genre[code='A']].title
        }`)
      const expected = cds.ql`SELECT from bookshop.Authors as Authors
            left outer join bookshop.Books as books on books.author_ID = Authors.ID AND
              exists (
                select 1 from bookshop.Genres as $g
                WHERE $g.ID = books.genre_ID and $g.code = 'A'
              )
            {
              Authors.ID,
              books.title as books_title
            }`
      expectCqn(transformed).to.equal(expected)
    })

    it('predicate inside infix filter - exists also has filter (with OR)', () => {
      const transformed = cqn4sql(
        cds.ql`SELECT from bookshop.Authors as Authors
           { ID,
             books[exists genre[code='A' or code='B']].title
           }`,
      )
      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
          left outer join bookshop.Books as books on books.author_ID = Authors.ID
            and exists (
                  select 1 from bookshop.Genres as $g
                  WHERE $g.ID = books.genre_ID
                    and ($g.code = 'A' or $g.code = 'B')
                )
        {
          Authors.ID,
          books.title as books_title
        }`
      expectCqn(transformed).to.equal(expected)
    })
  })
})
