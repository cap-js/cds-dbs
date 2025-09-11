'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn, expect } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('(nested projections) expand', () => {
  before(async () => {
    const m = await loadModel()
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, m)
  })

  describe('basic', () => {
    it('managed assoc, one field', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          author { name }
        }`)

      expect(transformed.SELECT.columns[0].SELECT).to.have.property('expand').that.equals(true)
      expect(transformed.SELECT.columns[0].SELECT).to.have.property('one').that.equals(true)

      const expected = cds.ql`
        SELECT from bookshop.Books as $B
        {
          (
            SELECT from bookshop.Authors as $a
            {
              $a.name
            } where $B.author_ID = $a.ID
          ) as author
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('prototype of the subquery is not polluted', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          author { name }
        }`)

      expect(transformed.SELECT.columns[0].SELECT).to.not.have.property('ref')
      expect(transformed.SELECT.columns[0].SELECT).to.have.property('expand').that.equals(true)
    })

    it('enforce external alias to texts expand', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as NotBooks
        {
          ID,
          texts { locale }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as NotBooks
        {
          NotBooks.ID,
          (
            SELECT $t.locale
            from bookshop.Books.texts as $t
            where $t.ID = NotBooks.ID
          ) as texts
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('with expressions', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          author
          {
            name,
            substring(placeOfBirth, 1, 1) as pob
          }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          (
            SELECT
              $a.name,
              substring($a.placeOfBirth, 1, 1) as pob
            from bookshop.Authors as $a
            where Books.author_ID = $a.ID
          ) as author
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('structured field is properly flattened', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          author
          {
            name,
            address
          }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          (
            SELECT
              $a.name,
              $a.address_street,
              $a.address_city
            from bookshop.Authors as $a
            where Books.author_ID = $a.ID
          ) as author
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('reference in order by is NOT referring to expand column', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books.twin
        {
          author
          {
            name
          }
        } order by author.name asc`)

      const expected = cds.ql`
        SELECT from bookshop.Books.twin as $t
          left join bookshop.Authors as author
            on author.ID = $t.author_ID
        {
          (
            SELECT $a.name
            from bookshop.Authors as $a
            where $t.author_ID = $a.ID
          ) as author
        } order by author.name asc`

      expectCqn(transformed).to.equal(expected)
    })

    it('within structure', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.DeepRecursiveAssoc
        {
          ID,
          one.two.three.toSelf
          {
            ID
          }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.DeepRecursiveAssoc as $D
        {
          $D.ID,
          (
            SELECT $o.ID
            from bookshop.DeepRecursiveAssoc as $o
            where $D.one_two_three_toSelf_ID = $o.ID
          ) as one_two_three_toSelf
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('in combination with scoped query', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books:author
        {
          name,
          books
          {
            title
          }
        }`)

      expect(transformed.SELECT.columns[1].SELECT).to.have.property('expand').that.equals(true)
      expect(transformed.SELECT.columns[1].SELECT).to.have.property('one').that.equals(false)

      const expected = cds.ql`
        SELECT from bookshop.Authors as $a
        {
          $a.name,
          (
            SELECT $b2.title
            from bookshop.Books as $b2
            where $a.ID = $b2.author_ID
          ) as books
        } where exists (
          SELECT 1 from bookshop.Books as $B
          where $B.author_ID = $a.ID
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('re-writing if on-condition has complex xpr', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.WorklistItems
        {
          ID,
          releaseChecks
          {
            ID,
            detailsDeviations
            {
              ID
            }
          }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.WorklistItems as $W
        {
          $W.ID,
          (
            SELECT from bookshop.WorklistItem_ReleaseChecks as $r
            {
              $r.ID,
              (
                SELECT from bookshop.QualityDeviations as $d
                {
                  $d.ID
                }
                where $d.material_ID = $r.parent_releaseDecisionTrigger_batch_material_ID
                  and (
                        $d.batch_ID = '*'
                    or  $d.batch_ID = $r.parent_releaseDecisionTrigger_batch_ID
                  )
                  and $d.snapshotHash = $r.snapshotHash
              ) as detailsDeviations
            }
            where $r.parent_ID = $W.ID
              and $r.parent_snapshotHash = $W.snapshotHash
          ) as releaseChecks
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('ignores expands which target ”@cds.persistence.skip”', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.NotSkipped as NotSkipped
        {
          ID,
          skipped
          {
            text
          }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.NotSkipped as NotSkipped
        {
          NotSkipped.ID
        }`

      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('wildcard', () => {
    it('managed association', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          author
          {
            *
          }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          (
            SELECT
              $a.createdAt,
              $a.createdBy,
              $a.modifiedAt,
              $a.modifiedBy,
              $a.ID,
              $a.name,
              $a.dateOfBirth,
              $a.dateOfDeath,
              $a.placeOfBirth,
              $a.placeOfDeath,
              $a.address_street,
              $a.address_city
            from bookshop.Authors as $a
            where Books.author_ID = $a.ID
          ) as author
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('respects smart wildcard rules', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors
        {
          name,
          books
          {
            'first' as first,
            'second' as ID,
            *,
            'third' as createdAt,
            'last' as last
          }
        }`)

      expect(transformed.SELECT.columns[1].SELECT).to.have.property('expand').that.equals(true)
      expect(transformed.SELECT.columns[1].SELECT).to.have.property('one').that.equals(false)

      const expected = cds.ql`
        SELECT from bookshop.Authors as $A
        {
          $A.name,
          (
            SELECT
              'first' as first,
              'second' as ID,
              'third' as createdAt,
              $b.createdBy,
              $b.modifiedAt,
              $b.modifiedBy,
              $b.anotherText,
              $b.title,
              $b.descr,
              $b.author_ID,
              $b.coAuthor_ID,
              $b.genre_ID,
              $b.stock,
              $b.price,
              $b.currency_code,
              $b.dedication_addressee_ID,
              $b.dedication_text,
              $b.dedication_sub_foo,
              $b.dedication_dedication,
              $b.coAuthor_ID_unmanaged,
              'last' as last
            from bookshop.Books as $b
            where $A.ID = $b.author_ID
          ) as books
        }`

      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('unmanaged', () => {
    it('backlink with simple condition AND backlink', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.SoccerTeams
        {
          goalKeeper { name }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.SoccerTeams as $S
        {
          (
            SELECT from bookshop.SoccerPlayers as $g
            {
              $g.name
            }
            where $g.jerseyNumber = 1 and ($S.ID = $g.team_ID)
          ) as goalKeeper
        }`

      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('modify correlated subquery', () => {
    it('with infix filter', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          author[name='King' or name like '%Sanderson'] { name }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as $B
        {
          (
            SELECT $a.name from bookshop.Authors as $a
              where $B.author_ID = $a.ID and ($a.name = 'King' or $a.name like '%Sanderson')
          ) as author
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('order by', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors
        {
          books[order by price] { title }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as $A
        {
          (
            SELECT from bookshop.Books as $b
            {
              $b.title
            }
            where $A.ID = $b.author_ID
            order by $b.price
          ) as books
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('order by + sort order, limit & offset', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          author[order by name asc limit 1 offset 1] { name }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as $B
        {
          (
            SELECT from bookshop.Authors as $a
            {
              $a.name
            }
            where $B.author_ID = $a.ID
            order by name ASC
            limit 1
            offset 1
          ) as author
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('query modifiers in ref are combined with sibling properties to expand', () => {
      const q = {
        SELECT: {
          from: {
            ref: ['bookshop.Books'],
          },
          columns: [
            {
              ref: [{ id: 'author', orderBy: [{ ref: ['dateOfBirth'], sort: 'desc' }] }],
              expand: [
                {
                  ref: ['name'],
                },
              ],
              limit: {
                offset: { val: 1 },
                rows: { val: 1 },
              },
              // this order by is overwritten by the one in the ref
              orderBy: [{ ref: ['dateOfDeath'], sort: 'asc' }],
            },
          ],
        },
      }

      const transformed = cqn4sql(q)

      const expected = cds.ql`
        SELECT from bookshop.Books as $B
        {
          (
            SELECT from bookshop.Authors as $a
            {
              $a.name
            }
            where $B.author_ID = $a.ID
            order by $a.dateOfDeath asc, $a.dateOfBirth desc
            limit 1
            offset 1
          ) as author
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('add where exists <assoc> shortcut to expand subquery where condition', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          author[exists books.author[name = 'King'] order by name asc limit 1 offset 1] { name }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as $B
        {
          (
            SELECT from bookshop.Authors as $a
            {
              $a.name
            }
            where $B.author_ID = $a.ID and
                exists (
                  SELECT 1 from bookshop.Books as $b2 where
                    $b2.author_ID = $a.ID and exists (
                      SELECT 1 from bookshop.Authors as $a2 where
                        $a2.ID = $b2.author_ID and
                        $a2.name = 'King'
                    )
                )
            order by name ASC
            limit 1
            offset 1
          ) as author
        }`

      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('with subqueries', () => {
    it('simple subquery in expands projection', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          author { name, (select title from bookshop.Books) as book }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as $B
        {
          (SELECT
              $a.name,
              (select $B2.title from bookshop.Books as $B2) as book
            from bookshop.Authors as $a
            where $B.author_ID = $a.ID) as author
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('correctly builds correlated subquery if selecting from subquery', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from (select author from bookshop.Books) as book
        {
          author { name }
        }`)

      const expected = cds.ql`
        SELECT from (select $B.author_ID from bookshop.Books as $B) as book
        {
          (SELECT
              $a.name
            from bookshop.Authors as $a
            where book.author_ID = $a.ID) as author
        }`

      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('rename elements', () => {
    // explicit alias for struc name is also used as table alias for subquery
    it('rename expand root', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          author as a
          {
            name
          }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          (
            SELECT $a.name
            from bookshop.Authors as $a
            where Books.author_ID = $a.ID
          ) as a
        }`

      expectCqn(transformed).to.equal(expected)
    })

    // column alias cannot be used as table alias for subquery
    // but must be used as column alias
    it('column alias clashes with query alias', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          author as books
          {
            name
          }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          (
            SELECT $b.name
            from bookshop.Authors as $b
            where Books.author_ID = $b.ID
          ) as books
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('multiple expands', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          author as a1
          {
            name
          },
          author as a2
          {
            name
          }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          (
            SELECT $a.name
            from bookshop.Authors as $a
            where Books.author_ID = $a.ID
          ) as a1,
          (
            SELECT $a2.name
            from bookshop.Authors as $a2
            where Books.author_ID = $a2.ID
          ) as a2
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('unfold expand, several fields with alias', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          author
          {
            name,
            dateOfBirth as dob,
            placeOfBirth as pob
          }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          (
            SELECT
              $a.name,
              $a.dateOfBirth as dob,
              $a.placeOfBirth as pob
            from bookshop.Authors as $a
            where Books.author_ID = $a.ID
          ) as author
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('structured field is renamed', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          author
          {
            name,
            address as BUBU
          }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          (
            SELECT
              $a.name,
              $a.address_street as BUBU_street,
              $a.address_city as BUBU_city
            from bookshop.Authors as $a
            where Books.author_ID = $a.ID
          ) as author
        }`

      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('path expressions before/within expands', () => {
    it('follow managed association to a field', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors
        {
          books
          {
            title,
            genre.name
          }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as $A
        {
          (
            SELECT $b.title, genre.name AS genre_name
            FROM bookshop.Books AS $b
              LEFT JOIN bookshop.Genres AS genre
                ON genre.ID = $b.genre_ID
            WHERE $A.ID = $b.author_ID
          ) as books
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('follow unmanaged association before expand', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          title,
          author.books
          {
            title
          }
        }`)

      expect(transformed.SELECT.columns[1].SELECT).to.have.property('expand').that.equals(true)
      expect(transformed.SELECT.columns[1].SELECT).to.have.property('one').that.equals(false) // to-many

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left join bookshop.Authors as author
            on author.ID = Books.author_ID
        {
          Books.title,
          (
            SELECT $a.title
            from bookshop.Books as $a
            where author.ID = $a.author_ID
          ) as author_books
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('follow unmanaged association before expand - re-use join node', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          title,
          author.name,
          author.books
          {
            title
          }
        }`)

      expect(transformed.SELECT.columns[2].SELECT).to.have.property('expand').that.equals(true)
      expect(transformed.SELECT.columns[2].SELECT).to.have.property('one').that.equals(false)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left join bookshop.Authors as author
            on author.ID = Books.author_ID
        {
          Books.title,
          author.name as author_name,
          (
            SELECT $a.title
            from bookshop.Books as $a
            where author.ID = $a.author_ID
          ) as author_books
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('follow unmanaged association before expand with filter - re-use join node', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          title,
          author.name,
          author.books[title = 'foo']
          {
            title
          }
        }`)

      expect(transformed.SELECT.columns[2].SELECT).to.have.property('expand').that.equals(true)
      expect(transformed.SELECT.columns[2].SELECT).to.have.property('one').that.equals(false)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left join bookshop.Authors as author
            on author.ID = Books.author_ID
        {
          Books.title,
          author.name as author_name,
          (
            SELECT $a.title
            from bookshop.Books as $a
            where author.ID = $a.author_ID and $a.title = 'foo'
          ) as author_books
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('follow 3 associations before expand with filter', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          title,
          author.name,
          Books.author.books.genre[name = 'foo']
          {
            name
          }
        }`)

      expect(transformed.SELECT.columns[2].SELECT).to.have.property('expand').that.equals(true)
      expect(transformed.SELECT.columns[2].SELECT).to.have.property('one').that.equals(true)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left join bookshop.Authors as author
            on author.ID = Books.author_ID
          left join bookshop.Books as books2
            on books2.author_ID = author.ID
        {
          Books.title,
          author.name as author_name,
          (
            SELECT $a.name
            from bookshop.Genres as $a
            where books2.genre_ID = $a.ID and $a.name = 'foo'
          ) as author_books_genre
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('follow 3 associations before expand with filter - re-use join node', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          title,
          author[name='Sanderson'].name,
          author[name='Sanderson'].books.genre
          {
            name
          }
        }`)

      expect(transformed.SELECT.columns[2].SELECT).to.have.property('expand').that.equals(true)
      expect(transformed.SELECT.columns[2].SELECT).to.have.property('one').that.equals(true)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left join bookshop.Authors as author
            on author.ID = Books.author_ID
              and author.name = 'Sanderson'
          left join bookshop.Books as books2
            on books2.author_ID = author.ID
        {
          Books.title,
          author.name as author_name,
          (
            SELECT $a.name
            from bookshop.Genres as $a
            where books2.genre_ID = $a.ID
          ) as author_books_genre
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('follow assoc which is key before expand', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.AssocAsKey
        {
          foo,
          toAuthor.books
          {
            title
          }
        }`)

      expect(transformed.SELECT.columns[1].SELECT).to.have.property('expand').that.equals(true)
      expect(transformed.SELECT.columns[1].SELECT).to.have.property('one').that.equals(false)

      const expected = cds.ql`
        SELECT from bookshop.AssocAsKey as $A
          left join bookshop.Authors as toAuthor
            on toAuthor.ID = $A.toAuthor_ID
        {
          $A.foo,
          (
            SELECT $t.title
            from bookshop.Books as $t
            where toAuthor.ID = $t.author_ID
          ) as toAuthor_books
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('drill into structure, navigate via assoc, drill into structure and expand', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.DeepRecursiveAssoc as $D
        {
          ID,
          one.two.three.toSelf.one.two.three.toSelf
          {
            ID
          }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.DeepRecursiveAssoc as $D
          left join bookshop.DeepRecursiveAssoc as toSelf
            on toSelf.ID = $D.one_two_three_toSelf_ID
        {
          $D.ID,
          (
            SELECT $o.ID
            from bookshop.DeepRecursiveAssoc as $o
            where toSelf.one_two_three_toSelf_ID = $o.ID
          ) as one_two_three_toSelf_one_two_three_toSelf
        }`

      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('nested', () => {
    it('unfold nested expands', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          author
          {
            books
            {
              genre
              {
                name
              }
            }
          }
        }`)

      // author
      expect(transformed.SELECT.columns[0].SELECT).to.have.property('expand').that.equals(true)
      expect(transformed.SELECT.columns[0].SELECT).to.have.property('one').that.equals(true)
      // books
      expect(transformed.SELECT.columns[0].SELECT.columns[0].SELECT).to.have.property('expand').that.equals(true)
      expect(transformed.SELECT.columns[0].SELECT.columns[0].SELECT).to.have.property('one').that.equals(false)
      // genre
      expect(transformed.SELECT.columns[0].SELECT.columns[0].SELECT.columns[0].SELECT)
        .to.have.property('expand')
        .that.equals(true)
      expect(transformed.SELECT.columns[0].SELECT.columns[0].SELECT.columns[0].SELECT)
        .to.have.property('one')
        .that.equals(true)

      const expected = cds.ql`
        SELECT from bookshop.Books as $B
        {
          (
            SELECT
              (
                SELECT
                  (
                    SELECT $g.name
                    FROM bookshop.Genres as $g
                      WHERE $b2.genre_ID = $g.ID
                  ) as genre
                FROM bookshop.Books AS $b2
                  WHERE $a.ID = $b2.author_ID
              ) as books
            FROM bookshop.Authors as $a
              WHERE $B.author_ID = $a.ID
          ) as author
        }`

      expectCqn(transformed).to.equal(expected)
    })
  })
})
