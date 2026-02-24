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

  describe('inner join in EXISTS subquery for path expressions in infix filter', () => {
    it('managed association', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          ID
        }
        WHERE EXISTS books[genre.name = 'Thriller']`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          Authors.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
            inner join bookshop.Genres as genre
              on genre.ID = $b.genre_ID
          WHERE $b.author_ID = Authors.ID
            and genre.name = 'Thriller'
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('managed association (scoped query)', () => {
      // equivalent to the above
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books[genre.name = 'Thriller']:author as Authors
        {
          ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          Authors.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B
            inner join bookshop.Genres as genre
              on genre.ID = $B.genre_ID
          WHERE $B.author_ID = Authors.ID
            and genre.name = 'Thriller'
        )`
      expectCqn(transformed).to.equal(expected)

    })

    it('managed association (2)', async () => {
      const transformed = cqn4sql(
        cds.ql`
        SELECT from Collaborations
        {
          id
        }
        WHERE EXISTS leads[participant.scholar_userID = $user.id]
      `,
      )

      const expected = cds.ql`
        SELECT from Collaborations as $C
        {
          $C.id
        }
        WHERE EXISTS (
          SELECT 1 from CollaborationLeads as $l
            inner join CollaborationParticipants as participant
              on participant.id = $l.participant_id
          WHERE ($l.collaboration_id = $C.id)
            and $l.isLead = true
            and participant.scholar_userID = $user.id
        )
      `

      expectCqn(transformed).to.equal(expected)
    })

    it('unmanaged association', () => {
      // match all authors which have co-authored at least one book with King
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          ID
        }
        WHERE EXISTS books[coAuthorUnmanaged.name = 'King']`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          Authors.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
            inner join bookshop.Authors as coAuthorUnmanaged
              on coAuthorUnmanaged.ID = $b.coAuthor_ID_unmanaged
          WHERE $b.author_ID = Authors.ID
            and coAuthorUnmanaged.name = 'King'
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('unmanaged association (scoped query)', () => {
      // equivalent to the above
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books[coAuthorUnmanaged.name = 'King']:author as Authors
        {
          ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          Authors.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B
            inner join bookshop.Authors as coAuthorUnmanaged
              on coAuthorUnmanaged.ID = $B.coAuthor_ID_unmanaged
          WHERE $B.author_ID = Authors.ID
            and coAuthorUnmanaged.name = 'King'
        )`

      expectCqn(transformed).to.equal(expected)
    })

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

    it('managed assoc within structure (scoped query)', () => {
      // equivalent to the above
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books[dedication.addressee.name = 'Hasso']:author as Authors
        {
          ID
        }`)
      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          Authors.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B
            inner join bookshop.Person as addressee on addressee.ID = $B.dedication_addressee_ID
          WHERE $B.author_ID = Authors.ID
            and addressee.name = 'Hasso'
        )`
      expectCqn(transformed).to.equal(expected)
    })

    it('multi step EXISTS predicate and multi step assoc traversal in filter', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          ID
        }
        WHERE EXISTS books.author.books[genre.parent.name = 'Thriller']`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          Authors.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
          WHERE $b.author_ID = Authors.ID
            and EXISTS (
              SELECT 1 from bookshop.Authors as $a
              WHERE $a.ID = $b.author_ID
                and EXISTS (
                  SELECT 1 from bookshop.Books as $b2
                    inner join bookshop.Genres as genre
                      on genre.ID = $b2.genre_ID
                    inner join bookshop.Genres as parent
                      on parent.ID = genre.parent_ID
                  WHERE $b2.author_ID = $a.ID
                    and parent.name = 'Thriller'
                )
            )
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('join relevant path is hidden in function', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          ID
        }
        WHERE EXISTS books[toLower(genre.name) = 'thriller']`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          Authors.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
            inner join bookshop.Genres as genre
              on genre.ID = $b.genre_ID
          WHERE $b.author_ID = Authors.ID
            and toLower(genre.name) = 'thriller'
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('join relevant path is hidden in function (scoped query)', () => {
      // equivalent to the above
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books[toLower(genre.name) = 'thriller']:author as Authors
        {
          ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          Authors.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B
            inner join bookshop.Genres as genre
              on genre.ID = $B.genre_ID
          WHERE $B.author_ID = Authors.ID
            and toLower(genre.name) = 'thriller'
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('join relevant path is hidden in xpr', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          1 as foo
        }
        WHERE EXISTS genre[('foo' || parent.name || 'bar') LIKE 'foo%bar']`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          1 as foo
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Genres as $g
            inner join bookshop.Genres as parent
              on parent.ID = $g.parent_ID
          WHERE $g.ID = Books.genre_ID
            and ('foo' || parent.name || 'bar') LIKE 'foo%bar'
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('join relevant path in function + sibling EXISTS with another path in filter', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          ID
        }
        WHERE EXISTS books[
          toLower(genre.name) = 'thriller'
          and EXISTS genre[parent.name = 'Fiction']
        ]`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          Authors.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
            inner join bookshop.Genres as genre
              on genre.ID = $b.genre_ID
          WHERE $b.author_ID = Authors.ID
            and toLower(genre.name) = 'thriller'
            and EXISTS (
              SELECT 1 from bookshop.Genres as $g
                inner join bookshop.Genres as parent
                  on parent.ID = $g.parent_ID
              WHERE $g.ID = $b.genre_ID
                and parent.name = 'Fiction'
            )
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('navigate to key, but with infix filter', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          ID
        }
        WHERE EXISTS books[genre[name = 'Drama'].ID is not null]`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          Authors.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
            inner join bookshop.Genres as genre
              on genre.ID = $b.genre_ID and
                 genre.name = 'Drama'
          WHERE $b.author_ID = Authors.ID
            and genre.ID is not null
        )`
      expectCqn(transformed).to.equal(expected)
    })
      

    it('join relevant path is hidden in nested function', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          ID
        }
        WHERE EXISTS books[toLower(toUpper(dedication.addressee.name)) = 'Hasso']`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          Authors.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b
            inner join bookshop.Person as addressee
              on addressee.ID = $b.dedication_addressee_ID
          where $b.author_ID = Authors.ID AND toLower(toUpper(addressee.name)) = 'Hasso'
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('join relevant path is hidden in nested function (scoped query)', () => {
      // equivalent to the above
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books[toLower(toUpper(dedication.addressee.name)) = 'Hasso']:author as Authors
        {
          ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          Authors.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B
            inner join bookshop.Person as addressee
              on addressee.ID = $B.dedication_addressee_ID
          where $B.author_ID = Authors.ID AND toLower(toUpper(addressee.name)) = 'Hasso'
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('scoped query with nested EXISTS with join relevant path', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors[EXISTS books[genre.name LIKE '%Fiction']]:books as books
        {
          ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as books
        {
          books.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Authors as $A
          WHERE $A.ID = books.author_ID
            and EXISTS (
              SELECT 1 from bookshop.Books as $b
                inner join bookshop.Genres as genre
                  on genre.ID = $b.genre_ID
              WHERE $b.author_ID = $A.ID
                and genre.name LIKE '%Fiction'
            )
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('multi-step navigation with filter (scoped query)', () => {
      // TODO: solve the following edge-case:
      //      1. `select from Genres[parent.name = 'FOO']:parent as parent { name }`
      //      2. recursive transform subquery: `select from Genres where parent.name = 'FOO'`
      //      --> if the outer query alias `parent` is available in the subquery,
      //      not the association `parent` would be used for name resolution,
      //      but the table alias `parent`
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books:genre[parent.name LIKE '%Fiction%'].parent
        {
          name
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Genres as $p
        {
          $p.name
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Genres as $g
            inner join bookshop.Genres as parent
              on parent.ID = $g.parent_ID
          WHERE $g.parent_ID = $p.ID
            and parent.name LIKE '%Fiction%'
            and EXISTS (
              SELECT 1 from bookshop.Books as $B
              WHERE $B.genre_ID = $g.ID
            )
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('in case statements', () => {
      // TODO: Aliases for genre could be improved
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          ID,
          case when EXISTS books[toLower(genre.name) = 'Thriller' and price>10]  then 1
               when EXISTS books[toLower(genre.name) = 'Thriller' and price>100 and EXISTS genre] then 2
          end as descr
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          Authors.ID,
          case
            when EXISTS (
              select 1 from bookshop.Books as $b
              inner join bookshop.Genres as genre on genre.ID = $b.genre_ID
              where $b.author_ID = Authors.ID and toLower(genre.name) = 'Thriller' and $b.price > 10
            )
            then 1
            when EXISTS (
              select 1 from bookshop.Books as $b2
              inner join bookshop.Genres as genre on genre.ID = $b2.genre_ID
              where $b2.author_ID = Authors.ID and toLower(genre.name) = 'Thriller' and $b2.price > 100
                    and EXISTS (
                      select 1 from bookshop.Genres as $g where $g.ID = $b2.genre_ID
                    )
            )
            then 2
          end as descr
        }`

      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('in where', () => {
    it('managed assoc after EXISTS and in expression', () => {
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
      WHERE EXISTS (
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
      WHERE EXISTS (
        SELECT 1 from bookshop.Genres as $p
        WHERE $p.parent_ID = parent.ID and EXISTS (
          SELECT 1 from bookshop.Genres as $p2
          WHERE $p2.parent_ID = $p.ID and EXISTS (
            SELECT 1 from bookshop.Genres as $g
            WHERE $g.parent_ID = $p2.ID and EXISTS (
              SELECT 1 from bookshop.Books as $b
              WHERE $b.genre_ID = $g.ID and EXISTS (
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
          case when EXISTS books[price>10]  then books[stock=1].genre[code='A'].descr
               when EXISTS books[price>100] then books[stock=1].genre[code='B' or code='C'].descr
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
          case when EXISTS (
                      select 1 from bookshop.Books as $b
                      WHERE $b.author_ID = Authors.ID and $b.price > 10
                    )
               then genre.descr
               when EXISTS (
                      select 1 from bookshop.Books as $b2
                      WHERE $b2.author_ID = Authors.ID and $b2.price > 100
                    )
               then genre2.descr
          end as descr
        }`
      expectCqn(transformed).to.equal(expected)
    })

    it('predicate inside infix filter - EXISTS also has filter', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          ID,
          books[EXISTS genre[code='A']].title
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
          left outer join bookshop.Books as books on books.author_ID = Authors.ID
            and EXISTS (
                  select 1 from bookshop.Genres as $g
                  WHERE $g.ID = books.genre_ID and $g.code = 'A'
                )
        {
          Authors.ID,
          books.title as books_title
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('predicate inside infix filter - EXISTS also has filter (with OR)', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          ID,
          books[EXISTS genre[code='A' or code='B']].title
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
          left outer join bookshop.Books as books on books.author_ID = Authors.ID
            and EXISTS (
                  SELECT 1 from bookshop.Genres as $g
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
