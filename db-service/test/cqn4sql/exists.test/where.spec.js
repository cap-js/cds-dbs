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
      let transformed = cqn4sql(cds.ql`SELECT from bookshop.Books { ID } WHERE EXISTS author`)
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
      let transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID } WHERE EXISTS Books.author`)
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
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books { ID } WHERE EXISTS dedication.addressee`)
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
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Authors { ID } WHERE EXISTS books`)
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
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Authors as Authors { ID } WHERE EXISTS Authors.books`)
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

  describe('multi step EXISTS', () => {
    it('with two associations', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Authors { ID } WHERE EXISTS books.author`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as $A
        {
          $A.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
          WHERE $b.author_ID = $A.ID
            and EXISTS (
              SELECT 1 from bookshop.Authors as $a2
              WHERE $a2.ID = $b.author_ID
            )
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('with two associations, last with backlink', () => {
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

    it('EXISTS has nested EXISTS and condition before navigating to genre', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors
        {
          ID
        }
        WHERE EXISTS books[EXISTS author or title = 'Gravity'].genre[name = 'Fiction']`)

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
              )
              or $b.title = 'Gravity'
            )
            and EXISTS (
              SELECT 1 from bookshop.Genres as $g
              WHERE $g.ID = $b.genre_ID
                and $g.name = 'Fiction'
            )
        )`

      expectCqn(transformed).to.equal(expected)
    })
    it('both assoc steps have infix filter with each one nested EXISTS', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors
        {
          ID
        }
        WHERE EXISTS books[EXISTS author or title = 'Gravity'].genre[name = 'Fiction' and EXISTS children[name = 'Foo']]`)

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
              )
              or $b.title = 'Gravity'
            )
            and EXISTS (
              SELECT 1 from bookshop.Genres as $g
              WHERE $g.ID = $b.genre_ID
                and $g.name = 'Fiction'
                and EXISTS (
                  SELECT 1 from bookshop.Genres as $c
                  WHERE $c.parent_ID = $g.ID
                    and $c.name = 'Foo'
                )
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

    it('nested EXISTS in filter with same auto-generated TA as outer query', () => {
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

    it('nested EXISTS in filter with same auto-generated TA as outer query + additional condition', () => {
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
      WHERE EXISTS books[ EXISTS coAuthorUnmanaged[ EXISTS books ] ]`)

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

    it('nested EXISTS in filter with same auto-generated TA as outer query + additional condition reversed', () => {
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

    it('EXISTS has two other EXISTS in infix filter', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors
        {
          ID
        }
        WHERE EXISTS books[NOT EXISTS author[EXISTS books]]`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as $A
        {
          $A.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
          WHERE $b.author_ID = $A.ID
            and NOT EXISTS (
              SELECT 1 from bookshop.Authors as $a2
              WHERE $a2.ID = $b.author_ID
                and EXISTS (
                  SELECT 1 from bookshop.Books as $b2
                  WHERE $b2.author_ID = $a2.ID
                )
            )
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('two round trips along EXISTS with four associations', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors
        {
          ID
        }
        WHERE EXISTS books.author.books.author`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as $A
        {
          $A.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
          WHERE $b.author_ID = $A.ID
            and EXISTS (
              SELECT 1 from bookshop.Authors as $a2
              WHERE $a2.ID = $b.author_ID
                and EXISTS (
                  SELECT 1 from bookshop.Books as $b2
                  WHERE $b2.author_ID = $a2.ID
                    and EXISTS (
                      SELECT 1 from bookshop.Authors as $a3
                      WHERE $a3.ID = $b2.author_ID
                    )
                )
            )
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('EXISTS with two adjacent four-association chains', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors
        {
          ID
        }
        WHERE EXISTS books.author.books.author
          and EXISTS books.author.books.author`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as $A
        {
          $A.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
          WHERE $b.author_ID = $A.ID
            and EXISTS (
              SELECT 1 from bookshop.Authors as $a2
              WHERE $a2.ID = $b.author_ID
                and EXISTS (
                  SELECT 1 from bookshop.Books as $b2
                  WHERE $b2.author_ID = $a2.ID
                    and EXISTS (
                      SELECT 1 from bookshop.Authors as $a3
                      WHERE $a3.ID = $b2.author_ID
                    )
                )
            )
        )
        and EXISTS (
          SELECT 1 from bookshop.Books as $b3
          WHERE $b3.author_ID = $A.ID
            and EXISTS (
              SELECT 1 from bookshop.Authors as $a4
              WHERE $a4.ID = $b3.author_ID
                and EXISTS (
                  SELECT 1 from bookshop.Books as $b4
                  WHERE $b4.author_ID = $a4.ID
                    and EXISTS (
                      SELECT 1 from bookshop.Authors as $a5
                      WHERE $a5.ID = $b4.author_ID
                    )
                )
            )
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it.skip('adjacent EXISTS subqueries could reuse the same table aliases independently', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors
        {
          ID
        }
        WHERE EXISTS books.author.books.author
          and EXISTS books.author.books.author`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          Authors.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as books
          WHERE author_ID = Authors.ID
            and EXISTS (
              SELECT 1 from bookshop.Authors as author
              WHERE ID = books.author_ID
                and EXISTS (
                  SELECT 1 from bookshop.Books as books2
                  WHERE author_ID = author.ID
                    and EXISTS (
                      SELECT 1 from bookshop.Authors as author2
                      WHERE ID = books2.author_ID
                    )
                )
            )
        )
        and EXISTS (
          SELECT 1 from bookshop.Books as books
          WHERE author_ID = Authors.ID
            and EXISTS (
              SELECT 1 from bookshop.Authors as author
              WHERE ID = books.author_ID
                and EXISTS (
                  SELECT 1 from bookshop.Books as books2
                  WHERE author_ID = author.ID
                    and EXISTS (
                      SELECT 1 from bookshop.Authors as author2
                      WHERE ID = books2.author_ID
                    )
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
        WHERE EXISTS books and name = 'Horst'`)
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

    it('EXISTS predicate is followed by association-like calculated element', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors
        {
          ID
        }
        WHERE EXISTS booksWithALotInStock and name = 'Horst'`)
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

    it('multiple EXISTS predicates with individual filters', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          ID
        }
        WHERE EXISTS genre.children[code = 'ABC'] or EXISTS genre.children[code = 'DEF']`)
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

    it('nested EXISTS within infix filter', () => {
      const query = cds.ql`
        SELECT from bookshop.Authors
        {
          ID
        }
        WHERE EXISTS books[ EXISTS genre[ parent = 1 ] ]`
      // some OData requests lead to a nested `xpr: [ EXISTS <assoc> ]` which
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

    it('four associations each has  filter', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors
        {
          ID
        }
        WHERE EXISTS books[stock > 11].author[name = 'Horst'].books[price < 9.99].author[placeOfBirth = 'Rom']`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as $A
        {
          $A.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
          WHERE $b.author_ID = $A.ID
            and $b.stock > 11
            and EXISTS (
              SELECT 1 from bookshop.Authors as $a2
              WHERE $a2.ID = $b.author_ID
                and $a2.name = 'Horst'
                and EXISTS (
                  SELECT 1 from bookshop.Books as $b2
                  WHERE $b2.author_ID = $a2.ID
                    and $b2.price < 9.99
                    and EXISTS (
                      SELECT 1 from bookshop.Authors as $a3
                      WHERE $a3.ID = $b2.author_ID
                        and $a3.placeOfBirth = 'Rom'
                    )
                )
            )
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('scoped query + EXISTS predicate in where', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books:genre as genre
        {
          ID
        }
        WHERE EXISTS parent`)

      const expected = cds.ql`
        SELECT from bookshop.Genres as genre
        {
          genre.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B
          where $B.genre_ID = genre.ID
        )
        AND EXISTS (
          SELECT 1 from bookshop.Genres as $p
          where $p.ID = genre.parent_ID
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('semantically same as above', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books:genre[EXISTS parent]
        {
          ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Genres as $g
        {
          $g.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B
          where $B.genre_ID = $g.ID
        )
        AND EXISTS (
          SELECT 1 from bookshop.Genres as $p
          where $p.ID = $g.parent_ID
        )`

      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('flattening of foreign keys', () => {
    it('association has structured FK', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID } WHERE EXISTS a_struc`)

      const expected = cds.ql`
        SELECT from bookshop.AssocMaze1 as AM
        {
          AM.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.AssocMaze2 as $a
          WHERE $a.ID_1_a = AM.a_struc_ID_1_a
            and $a.ID_1_b = AM.a_struc_ID_1_b
            and $a.ID_2_a = AM.a_struc_ID_2_a
            and $a.ID_2_b = AM.a_struc_ID_2_b
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('association has explicit scalar FKs', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID } WHERE EXISTS a_strucX`)

      const expected = cds.ql`
        SELECT from bookshop.AssocMaze1 as AM
        {
          AM.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.AssocMaze2 as $a
          WHERE $a.a = AM.a_strucX_a
            and $a.b = AM.a_strucX_b
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('association has explicit structured FKs', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID } WHERE EXISTS a_strucY`)

      const expected = cds.ql`
        SELECT from bookshop.AssocMaze1 as AM
        {
          AM.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.AssocMaze2 as $a
          WHERE $a.S_1_a = AM.a_strucY_S_1_a
            and $a.S_1_b = AM.a_strucY_S_1_b
            and $a.S_2_a = AM.a_strucY_S_2_a
            and $a.S_2_b = AM.a_strucY_S_2_b
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('association has explicit structured renamed FKs', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID } WHERE EXISTS a_strucXA`)

      const expected = cds.ql`
        SELECT from bookshop.AssocMaze1 as AM
        {
          AM.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.AssocMaze2 as $a
          WHERE $a.S_1_a = AM.a_strucXA_T_1_a
            and $a.S_1_b = AM.a_strucXA_T_1_b
            and $a.S_2_a = AM.a_strucXA_T_2_a
            and $a.S_2_b = AM.a_strucXA_T_2_b
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('association has FKs that are managed associations', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID } WHERE EXISTS a_assoc`)

      const expected = cds.ql`
        SELECT from bookshop.AssocMaze1 as AM
        {
          AM.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.AssocMaze3 as $a
          WHERE $a.assoc1_ID_1_a = AM.a_assoc_assoc1_ID_1_a
            and $a.assoc1_ID_1_b = AM.a_assoc_assoc1_ID_1_b
            and $a.assoc1_ID_2_a = AM.a_assoc_assoc1_ID_2_a
            and $a.assoc1_ID_2_b = AM.a_assoc_assoc1_ID_2_b
            and $a.assoc2_ID_1_a = AM.a_assoc_assoc2_ID_1_a
            and $a.assoc2_ID_1_b = AM.a_assoc_assoc2_ID_1_b
            and $a.assoc2_ID_2_a = AM.a_assoc_assoc2_ID_2_a
            and $a.assoc2_ID_2_b = AM.a_assoc_assoc2_ID_2_b
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('association has explicit FKs that are managed associations', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID } WHERE EXISTS a_assocY`)

      const expected = cds.ql`
        SELECT from bookshop.AssocMaze1 as AM
        {
          AM.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.AssocMaze2 as $a
          WHERE $a.A_1_a = AM.a_assocY_A_1_a
            and $a.A_1_b_ID = AM.a_assocY_A_1_b_ID
            and $a.A_2_a = AM.a_assocY_A_2_a
            and $a.A_2_b_ID = AM.a_assocY_A_2_b_ID
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('association has explicit aliased FKs that are managed associations', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID } WHERE EXISTS a_assocYA`)

      const expected = cds.ql`
        SELECT from bookshop.AssocMaze1 as AM
        {
          AM.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.AssocMaze2 as $a
          WHERE $a.A_1_a = AM.a_assocYA_B_1_a
            and $a.A_1_b_ID = AM.a_assocYA_B_1_b_ID
            and $a.A_2_a = AM.a_assocYA_B_2_a
            and $a.A_2_b_ID = AM.a_assocYA_B_2_b_ID
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('association has FKs that are mix of structured and managed associations', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID } WHERE EXISTS a_strass`)

      const expected = cds.ql`
        SELECT from bookshop.AssocMaze1 as AM
        {
          AM.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.AssocMaze4 as $a
          WHERE $a.A_1_a = AM.a_strass_A_1_a
            and $a.A_1_b_assoc1_ID_1_a = AM.a_strass_A_1_b_assoc1_ID_1_a
            and $a.A_1_b_assoc1_ID_1_b = AM.a_strass_A_1_b_assoc1_ID_1_b
            and $a.A_1_b_assoc1_ID_2_a = AM.a_strass_A_1_b_assoc1_ID_2_a
            and $a.A_1_b_assoc1_ID_2_b = AM.a_strass_A_1_b_assoc1_ID_2_b
            and $a.A_1_b_assoc2_ID_1_a = AM.a_strass_A_1_b_assoc2_ID_1_a
            and $a.A_1_b_assoc2_ID_1_b = AM.a_strass_A_1_b_assoc2_ID_1_b
            and $a.A_1_b_assoc2_ID_2_a = AM.a_strass_A_1_b_assoc2_ID_2_a
            and $a.A_1_b_assoc2_ID_2_b = AM.a_strass_A_1_b_assoc2_ID_2_b
            and $a.A_2_a = AM.a_strass_A_2_a
            and $a.A_2_b_assoc1_ID_1_a = AM.a_strass_A_2_b_assoc1_ID_1_a
            and $a.A_2_b_assoc1_ID_1_b = AM.a_strass_A_2_b_assoc1_ID_1_b
            and $a.A_2_b_assoc1_ID_2_a = AM.a_strass_A_2_b_assoc1_ID_2_a
            and $a.A_2_b_assoc1_ID_2_b = AM.a_strass_A_2_b_assoc1_ID_2_b
            and $a.A_2_b_assoc2_ID_1_a = AM.a_strass_A_2_b_assoc2_ID_1_a
            and $a.A_2_b_assoc2_ID_1_b = AM.a_strass_A_2_b_assoc2_ID_1_b
            and $a.A_2_b_assoc2_ID_2_a = AM.a_strass_A_2_b_assoc2_ID_2_a
            and $a.A_2_b_assoc2_ID_2_b = AM.a_strass_A_2_b_assoc2_ID_2_b
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('association has explicit FKs that are path into a structure', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID } WHERE EXISTS a_part`)

      const expected = cds.ql`
        SELECT from bookshop.AssocMaze1 as AM
        {
          AM.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.AssocMaze2 as $a
          WHERE $a.A_1_a = AM.a_part_a
            and $a.S_2_b = AM.a_part_b
        )`

      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('on-condition flattening', () => {
    it('drill down into foreign keys', () => {
      const query = cqn4sql(cds.ql`SELECT from a2j.Foo as Foo { ID } WHERE EXISTS buzUnmanaged`)
      const expected = cds.ql`
        SELECT from a2j.Foo as Foo {
          Foo.ID
        }
        WHERE EXISTS (
          SELECT 1 from a2j.Buz as $b
          where $b.bar_foo_ID = Foo.bar_foo_ID and $b.bar_ID = Foo.bar_ID and $b.foo_ID = Foo.ID
        )`
      expectCqn(query).to.equal(expected)
    })
  })
})
