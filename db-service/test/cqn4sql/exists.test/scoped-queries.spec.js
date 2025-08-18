'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn, expect } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('(exist predicate) scoped queries', () => {
  before(async () => {
    const m = await loadModel()
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, m)
  })

  describe('simple', () => {
    it('managed', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books:author
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
          where $B.author_ID = $a.ID
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('managed with explicit table alias', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books:author as author
        {
          author.name
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as author {
          author.name
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B
          where $B.author_ID = author.ID
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('managed with mean explicit table alias', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books:author as $B
        {
          name,
          $B.dateOfBirth
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as $B
        {
          $B.name,
          $B.dateOfBirth
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B2
          where $B2.author_ID = $B.ID
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('unmanaged', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Baz:parent
        {
          id
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Baz as $p
        {
          $p.id
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Baz as $B
          where $p.id = $B.parent_id or $p.id > 17
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('unmanaged with explicit table alias', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Baz:parent as A
        {
          id
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Baz as A
        {
          A.id
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Baz as $B
          where A.id = $B.parent_id or A.id > 17
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('unmanaged with mean explicit table alias', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Baz:parent as $B
        {
          id
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Baz as $B
        {
          $B.id
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Baz as $B2
          where $B.id = $B2.parent_id or $B.id > 17
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('backlink', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors:books as books
        {
          books.ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as books {
          books.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Authors as $A
          where $A.ID = books.author_ID
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('assoc within structure', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books:dedication.addressee
        {
          dateOfBirth
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Person as $a {
          $a.dateOfBirth
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B
          where $B.dedication_addressee_ID = $a.ID
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('assoc within structure (deep)', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.DeepRecursiveAssoc:one.two.three.toSelf
        {
          ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.DeepRecursiveAssoc as $t
        {
          $t.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.DeepRecursiveAssoc as $D
          where $D.one_two_three_toSelf_ID = $t.ID
        )`

      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('with infix filter', () => {
    it('at leaf managed', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books:author[ID=4711] as author
        {
          author.ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as author
        {
          author.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B
          where $B.author_ID = author.ID
        ) and author.ID=4711`

      expectCqn(transformed).to.equal(expected)
    })

    it('at leaf unmanaged', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Baz:parent[id<20] as my
        {
          my.id
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Baz as my
        {
          my.id
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Baz as $B
          where my.id = $B.parent_id or my.id > 17
        ) AND my.id < 20`

      expectCqn(transformed).to.equal(expected)
    })

    it('at leaf unmanaged, multiple conditions with `OR`', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Baz:parent[id<20 or id > 12] as my
        {
          my.id
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Baz as my
        {
          my.id
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Baz as $B
          where my.id = $B.parent_id or my.id > 17
        ) AND (my.id < 20 or my.id > 12)`

      expectCqn(transformed).to.equal(expected)
    })

    it('at leaf with OR needs to be put in brackets', () => {
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

    it('at root', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books[ID=201]:author as author
        {
          author.ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as author
        {
          author.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B
          where $B.author_ID = author.ID and $B.ID=201
        )`

      expectCqn(transformed).to.equal(expected)
    })

    // (SMW) here the explicit WHERE comes at the end (as it should be)
    it('at leaf, at root and existing where', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books[ID=201 or ID=202]:author[ID=4711 or ID=4712] as author
        {
          author.ID
        }
        where author.name='foo' or name='bar'`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as author
        {
          author.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B
          where $B.author_ID = author.ID and ($B.ID=201 or $B.ID=202)
        ) and (author.ID=4711 or author.ID=4712) and (author.name='foo' or author.name='bar')`

      expectCqn(transformed).to.equal(expected)
    })

    it('OData shortcut w/o mentioning key', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books[201]:author[150]
        {
          ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as $a
        {
          $a.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B
          where $B.author_ID = $a.ID and $B.ID=201
        ) AND $a.ID = 150`

      expectCqn(transformed).to.equal(expected)
    })

    it('OData shortcut w/o mentioning key (2)', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Orders[201]:items[2]
        {
          pos
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Orders.items as $i
        {
          $i.pos
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Orders as $O
          where $O.ID = $i.up__ID and $O.ID = 201
        ) AND $i.pos = 2`

      expectCqn(transformed).to.equal(expected)
    })

    // usually, OData shortcut notation only works for assocs with exactly one foreign key
    // but because "up__ID" is the foreign key for the backlink association of "items", it is already part of the inner
    // `where` condition of the exists subquery. Hence we enable this shortcut notation.
    it('OData shortcut w/o mentioning key (3) - for composition of aspects ', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Orders:items[2]
        {
          pos
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Orders.items as $i
        {
          $i.pos
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Orders as $O
          where $O.ID = $i.up__ID
        ) and $i.pos = 2`

      expectCqn(transformed).to.equal(expected)
    })

    it('same as above but explicitly mention key', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Orders:items[pos=2]
        {
          pos
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Orders.items as $i
        {
          $i.pos
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Orders as $O
          where $O.ID = $i.up__ID
        ) and $i.pos = 2`

      expectCqn(transformed).to.equal(expected)
    })

    // TODO
    it.skip('should this be possible?', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Orders.items[2] {pos}`)).to.throw(
        /Please specify all primary keys in the infix filter/,
      )
    })

    it('exists predicate within infix filter', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors[exists books]
        {
          ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as $A
        {
          $A.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
          where $b.author_ID = $A.ID
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('exists predicate within infix filter at leaf', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books:author[exists books]
        {
          ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as $a
        {
          $a.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B
          where $B.author_ID = $a.ID
        ) and EXISTS (
          SELECT 1 from bookshop.Books as $b2
          where $b2.author_ID = $a.ID
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('exists predicate within infix filter at root', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books[exists genre]:author
        {
          ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as $a
        {
          $a.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B
          where $B.author_ID = $a.ID
            and EXISTS (
              SELECT 1 from bookshop.Genres as $g
              where $g.ID = $B.genre_ID
            )
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('exists predicate within infix filter at root and leaf', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books[exists genre]:author[exists books]
        {
          ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as $a
        {
          $a.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B
          where $B.author_ID = $a.ID
          and EXISTS (
            SELECT 1 from bookshop.Genres as $g
            where $g.ID = $B.genre_ID
          )
        ) and EXISTS (
          SELECT 1 from bookshop.Books as $b2
          where $b2.author_ID = $a.ID
        )`

      expectCqn(transformed).to.equal(expected)
    })

    // (SMW) TODO: Order
    //  semantically correct, but order of infix filter and exists subqueries not consistent
    it('exists predicate within infix filter at root, leaf and middle', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books[exists genre]:author[exists books].books[exists genre]
        {
          ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as $b
        {
          $b.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Authors as $a where $a.ID = $b.author_ID
            and EXISTS (
              SELECT 1 from bookshop.Books as $b2 where $b2.author_ID = $a.ID
            )
            and EXISTS (
              SELECT 1 from bookshop.Books as $B3 where $B3.author_ID = $a.ID
                and EXISTS (
                  SELECT 1 from bookshop.Genres as $g where $g.ID = $B3.genre_ID
                )
            )
        ) and EXISTS (
          SELECT 1 from bookshop.Genres as $g2 where $g2.ID = $b.genre_ID
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('multiple, nested exists predicate within infix filter at leaf', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books:author[exists books[exists coAuthorUnmanaged or title = 'Sturmhöhe']]
        {
          ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as $a
        {
          $a.ID
        }
        where exists (
          SELECT 1 from bookshop.Books as $B where $B.author_ID = $a.ID
        ) and exists (
          SELECT 1 from bookshop.Books as $b2 where $b2.author_ID = $a.ID
          and
          (
            exists (
              SELECT 1 from bookshop.Authors as $c where $c.ID = $b2.coAuthor_ID_unmanaged
            ) or $b2.title = 'Sturmhöhe'
          )
        )`

      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('multiple association navigation', () => {
    it('two associations', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors:books.genre as genre
        {
          genre.ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Genres as genre
        {
          genre.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
          where $b.genre_ID = genre.ID and EXISTS (
            SELECT 1 from bookshop.Authors as $A
            where $A.ID = $b.author_ID
          )
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('two associations (mean alias)', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors:books.genre as $b
        {
          $b.ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Genres as $b
        {
          $b.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b2
          where $b2.genre_ID = $b.ID and EXISTS (
            SELECT 1 from bookshop.Authors as $A
            where $A.ID = $b2.author_ID
          )
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('three associations', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors:books.genre.parent as $p
        {
          $p.ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Genres as $p
        {
          $p.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Genres as $g
          where $g.parent_ID = $p.ID and EXISTS (
            SELECT 1 from bookshop.Books as $b
            where $b.genre_ID = $g.ID and EXISTS (
              SELECT 1 from bookshop.Authors as $A
              where $A.ID = $b.author_ID
            )
          )
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('two associations, first is association-like calculated element', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors:booksWithALotInStock.genre as genre
        {
          genre.ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Genres as genre
        {
          genre.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
          where $b.genre_ID = genre.ID and EXISTS (
            SELECT 1 from bookshop.Authors as $A
            where ( $A.ID = $b.author_ID ) and ( $b.stock > 100 )
          )
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('recursive association cascade', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors:books.genre.parent.parent.parent as $p
        {
          $p.ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Genres as $p
        {
          $p.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Genres as $p2
          where $p2.parent_ID = $p.ID and EXISTS (
            SELECT 1 from bookshop.Genres as $p3
            where $p3.parent_ID = $p2.ID and EXISTS (
              SELECT 1 from bookshop.Genres as $g
              where $g.parent_ID = $p3.ID and EXISTS (
                SELECT 1 from bookshop.Books as $b
                where $b.genre_ID = $g.ID and EXISTS (
                  SELECT 1 from bookshop.Authors as $A
                  where $A.ID = $b.author_ID
                )
              )
            )
          )
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('does not ignore the expand root from being considered for the table alias calculation', () => {
      const originalQuery = cds.ql`
        SELECT from bookshop.Genres:parent.parent.parent
        {
          ID
        }`
      // table aliases for `query.SELECT.expand === true` are not materialized in the transformed query and must be ignored
      // however, for the main query having the `query.SELECT.expand === 'root'` we must consider the table aliases
      originalQuery.SELECT.expand = 'root'
      const transformed = cqn4sql(originalQuery)

      // clean up so that the queries match
      delete originalQuery.SELECT.expand

      const expected = cds.ql`
        SELECT from bookshop.Genres as $p { $p.ID }
        where exists (
          SELECT 1 from bookshop.Genres as $p2
            where $p2.parent_ID = $p.ID and
            exists (
              SELECT 1 from bookshop.Genres as $p3
                where $p3.parent_ID = $p2.ID  and
                exists (
                  SELECT 1 from bookshop.Genres as $G
                  where $G.parent_ID = $p3.ID
                )
            )
        )
      `

      expectCqn(transformed).to.equal(expected)
    })
  })
})
