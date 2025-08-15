'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('(exist predicate) in where conditions', () => {
  before(async () => {
    const m = await loadModel()
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, m)
  })

  describe('simple', () => {
    it('one managed association', () => {
      let transformed = cqn4sql(cds.ql`SELECT from bookshop.Books { ID } where exists author`)
      const expected = cds.ql`
        SELECT from bookshop.Books as $B
        {
          $B.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Authors as $a
          WHERE $a.ID = $B.author_ID
        )`
      expectCqn(transformed).to.equal(expected)
    })
    it('one managed association, with explicit table alias', () => {
      let transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID
        }
        WHERE EXISTS Books.author`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          Books.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Authors as $a
          WHERE $a.ID = Books.author_ID
        )`
      expectCqn(transformed).to.equal(expected)
    })

    it('managed assoc within structure', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          ID
        }
        WHERE EXISTS dedication.addressee`)
      const expected = cds.ql`
        SELECT from bookshop.Books as $B
        {
          $B.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Person as $a
          WHERE $a.ID = $B.dedication_addressee_ID
        )`
      expectCqn(transformed).to.equal(expected)
    })

    it('one unmanaged association (to-many)', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors
        {
          ID
        }
        WHERE EXISTS books`)
      const expected = cds.ql`
        SELECT from bookshop.Authors as $A
        {
          $A.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
          WHERE $b.author_ID = $A.ID
        )`
      expectCqn(transformed).to.equal(expected)
    })

    it('one unmanaged association, with explicit table alias (to-many)', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          ID
        }
        WHERE EXISTS Authors.books`)
      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          Authors.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
          WHERE $b.author_ID = Authors.ID
        )`
      expectCqn(transformed).to.equal(expected)
    })

    it('one unmanaged association, with explicit table alias only in from (to-many)', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors as A
        {
          ID
        }
        WHERE EXISTS books`)
      const expected = cds.ql`
        SELECT from bookshop.Authors as A
        {
          A.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
          WHERE $b.author_ID = A.ID
        )`
      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('multi step exists', () => {
    it('two associations, last with backlink', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          ID
        }
        WHERE EXISTS author.books[title = 'Harry Potter']`)
      const expected = cds.ql`
        SELECT from bookshop.Books as $B
        {
          $B.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Authors as $a
          WHERE $a.ID = $B.author_ID and EXISTS (
            SELECT 1 from bookshop.Books as $b2
            WHERE $b2.author_ID = $a.ID and $b2.title = 'Harry Potter'
          )
        )`
      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('table alias assignment', () => {
    it('query source TA has the same name as the assoc', () => {
      // element name wins over table alias
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors as books
        {
          ID
        }
        WHERE EXISTS books`)
      const expected = cds.ql`
        SELECT from bookshop.Authors as books
        {
          books.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
          WHERE $b.author_ID = books.ID
        )`
      expectCqn(transformed).to.equal(expected)
    })

    it('query source TA has the same name as the assoc and is used as prefix', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors as books
        {
          ID
        }
        WHERE EXISTS books.books`)
      const expected = cds.ql`
        SELECT from bookshop.Authors as books
        {
          books.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
          WHERE $b.author_ID = books.ID
        )`
      expectCqn(transformed).to.equal(expected)
    })

    it('nested exists in filter with same auto-generated TA as outer query', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          ID
        }
        WHERE EXISTS author[EXISTS books[title = 'Harry Potter']]`)
      const expected = cds.ql`
        SELECT from bookshop.Books as $B
        {
          $B.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Authors as $a
          WHERE $a.ID = $B.author_ID and EXISTS (
          SELECT 1 from bookshop.Books as $b2
          WHERE $b2.author_ID = $a.ID and $b2.title = 'Harry Potter'
          )
        )`
      expectCqn(transformed).to.equal(expected)
    })

    it('nested exists in filter with same auto-generated TA as outer query + additional condition', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors
        {
          ID
        }
        WHERE EXISTS books[EXISTS author or title = 'Gravity']`)
      const expected = cds.ql`
        SELECT from bookshop.Authors as $A
        {
          $A.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
          WHERE $b.author_ID = $A.ID
          and (
            EXISTS (
              SELECT 1 from bookshop.Authors as $a2
              WHERE $a2.ID = $b.author_ID
            ) or $b.title = 'Gravity'
          )
        )`
      expectCqn(transformed).to.equal(expected)
    })
    it('nested EXISTS with unmanaged assoc', () => {
      const transformed = cqn4sql(cds.ql`
      SELECT from bookshop.Authors
      {
        ID
      }
      WHERE EXISTS books[ EXISTS coAuthorUnmanaged[ EXISTS books ]
      ]`)

      const expected = cds.ql`
      SELECT from bookshop.Authors as $A
      {
        $A.ID
      }
      WHERE EXISTS (
        SELECT 1 from bookshop.Books as $b
        WHERE $b.author_ID = $A.ID and EXISTS (
          SELECT 1 from bookshop.Authors as $c
          WHERE $c.ID = $b.coAuthor_ID_unmanaged and EXISTS (
            SELECT 1 from bookshop.Books as $b2
            WHERE $b2.author_ID = $c.ID
          )
        )
      )`

      expectCqn(transformed).to.equal(expected)
    })

    it('nested exists in filter with same auto-generated TA as outer query + additional condition reversed', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors
        {
          ID
        }
        WHERE EXISTS books[title = 'Gravity' or EXISTS author]`)
      const expected = cds.ql`
      SELECT from bookshop.Authors as $A
      {
        $A.ID
      }
      WHERE EXISTS (
        SELECT 1 from bookshop.Books as $b
        WHERE $b.author_ID = $A.ID
          and (
            $b.title = 'Gravity'
              or EXISTS (
                SELECT 1 from bookshop.Authors as $a2
                WHERE $a2.ID = $b.author_ID
              )
          )
      )`
      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('where condition merging', () => {
    // make sure that infix-filter conditions and additional conditions
    // are merged into the transformed where condition

    it('simple additional condition', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors
        {
          ID
        }
        WHERE exists books and name = 'Horst'`)
      const expected = cds.ql`
        SELECT from bookshop.Authors as $A
        {
          $A.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
          WHERE $b.author_ID = $A.ID
        ) and $A.name = 'Horst'`
      expectCqn(transformed).to.equal(expected)
    })

    it('exists predicate is followed by association-like calculated element', () => {
      const transformed = cqn4sql(
        cds.ql`SELECT from bookshop.Authors { ID } WHERE exists booksWithALotInStock and name = 'Horst'`,
      )
      const expected = cds.ql`
        SELECT from bookshop.Authors as $A
        {
          $A.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
          WHERE ( $b.author_ID = $A.ID ) and ( $b.stock > 100 )
        ) and $A.name = 'Horst'`
      expectCqn(transformed).to.equal(expected)
    })

    it('simple infix filter on leaf', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          ID
        }
        WHERE EXISTS author[name = 'Sanderson']`)
      const expected = cds.ql`
        SELECT from bookshop.Books as $B
        {
          $B.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Authors as $a
          WHERE $a.ID = $B.author_ID and $a.name = 'Sanderson'
        )`
      expectCqn(transformed).to.equal(expected)
    })

    it('shortcut notation in filter auto-coerce target key', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          ID
        }
        WHERE EXISTS author[17]`)
      const expected = cds.ql`
        SELECT from bookshop.Books as $B
        {
          $B.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Authors as $a
          WHERE $a.ID = $B.author_ID and $a.ID = 17
        )`
      expectCqn(transformed).to.equal(expected)
    })

    it('simple infix filter on leaf (unmanaged)', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors
        {
          ID
        }
        WHERE EXISTS books[title = 'ABAP Objects']`)
      const expected = cds.ql`
        SELECT from bookshop.Authors as $A
        {
          $A.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
          WHERE $b.author_ID = $A.ID and $b.title = 'ABAP Objects'
        )`
      expectCqn(transformed).to.equal(expected)
    })

    it('structure access in filter', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors
        {
          ID
        }
        WHERE EXISTS books[dedication.text = 'For Hasso']`)
      const expected = cds.ql`
        SELECT from bookshop.Authors as $A
        {
          $A.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
          WHERE $b.author_ID = $A.ID and $b.dedication_text = 'For Hasso'
        )`
      expectCqn(transformed).to.equal(expected)
    })

    it('multiple exists predicates with individual filters', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          ID
        }
        WHERE EXISTS genre.children[code = 'ABC'] or exists genre.children[code = 'DEF']`)
      const expected = cds.ql`
        SELECT from bookshop.Books as $B
        {
          $B.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Genres as $g
          WHERE $g.ID = $B.genre_ID
          and EXISTS (
            SELECT 1 from bookshop.Genres as $c
            WHERE $c.parent_ID = $g.ID and $c.code = 'ABC'
          )
        )
        or EXISTS (
            SELECT 1 from bookshop.Genres as $g2
            WHERE $g2.ID = $B.genre_ID
            and EXISTS (
              SELECT 1 from bookshop.Genres as $c2
              WHERE $c2.parent_ID = $g2.ID and $c2.code = 'DEF'
            )
        )`
      expectCqn(transformed).to.equal(expected)
    })

    it('additional condition with OR needs to be wrapped in brackets', () => {
      const transformed = cqn4sql(cds.ql`
      SELECT from bookshop.Authors
      {
        ID
      }
      WHERE EXISTS books[contains(title, 'Gravity') or contains(title, 'Dark')]`)
      const expected = cds.ql`
      SELECT from bookshop.Authors as $A
      {
        $A.ID
      }
      WHERE EXISTS (
        SELECT 1 from bookshop.Books as $b
        WHERE $b.author_ID = $A.ID and ( contains($b.title, 'Gravity') or contains($b.title, 'Dark') )
      )`
      expectCqn(transformed).to.equal(expected)
    })

    it('hidden in xpr', () => {
      const query = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          ID
        }
        WHERE ( ( EXISTS author[name = 'Schiller'] ) + 2 ) = 'foo'`)
      const expected = cds.ql`
        SELECT from bookshop.Books as $B
        {
          $B.ID
        }
        WHERE (
          (
            EXISTS (
              SELECT 1 from bookshop.Authors as $a
              WHERE $a.ID = $B.author_ID and $a.name = 'Schiller'
            )
          ) + 2
        ) = 'foo'`
      expectCqn(query).to.equal(expected)
    })

    it('nested exists within infix filter', () => {
      const query = cds.ql`
        SELECT from bookshop.Authors
        {
          ID
        }
        WHERE EXISTS books[ EXISTS genre[ parent = 1 ] ]`
      // some OData requests lead to a nested `xpr: [ exists <assoc> ]` which
      // cannot be expressed with the template string cds.ql`` builder
      query.SELECT.where[1].ref[0].where = [{ xpr: [...query.SELECT.where[1].ref[0].where] }]

      const transformed = cqn4sql(query)
      const expected = cds.ql`
        SELECT from bookshop.Authors as $A
        {
          $A.ID
        }
        WHERE EXISTS (
                SELECT 1 from bookshop.Books as $b
                WHERE $b.author_ID = $A.ID
                and EXISTS (
                      SELECT 1 from bookshop.Genres as $g
                      WHERE $g.ID = $b.genre_ID and $g.parent_ID = 1
                    )
        )`
      // cannot be expressed with the template string cds.ql`` builder
      expected.SELECT.where[1].SELECT.where.splice(4, Infinity, {
        xpr: [...expected.SELECT.where[1].SELECT.where.slice(4)],
      })
      expectCqn(transformed).to.equal(expected)
    })

    it('negation of expression', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          ID
        }
        WHERE EXISTS author[not (name = 'Sanderson')]`)
      const expected = cds.ql`
        SELECT from bookshop.Books as $B
        {
          $B.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Authors as $a
          WHERE $a.ID = $B.author_ID and not ($a.name = 'Sanderson')
        )`
      expectCqn(transformed).to.equal(expected)
    })
  })
})
