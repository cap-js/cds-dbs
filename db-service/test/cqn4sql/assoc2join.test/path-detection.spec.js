'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn, expect } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('(a2j) path detection', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, model)
  })

  describe('in where', () => {
    it('basic', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID } where author.name = 'Schiller'`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
         {
           Books.ID
         }
         WHERE author.name = 'Schiller'`
      expectCqn(transformed).to.equal(expected)
    })

    it('in expression', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID
        }
        WHERE ((author.name + 's') = 'Schillers') or ((author.name + 's') = 'Goethes')`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
        {
          Books.ID
        }
        WHERE ((author.name + 's') = 'Schillers') or ((author.name + 's') = 'Goethes')`
      expectCqn(transformed).to.equal(expected)
    })

    it('in list', () => {
      const transformed = cqn4sql(
        cds.ql`SELECT from bookshop.Books as Books { ID } where (author.name, 1) in ('foo', 'bar')`,
      )
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
        {
          Books.ID
        }
        WHERE (author.name, 1) in ('foo', 'bar')`
      expectCqn(transformed).to.equal(expected)
    })

    it('in tuple within list', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        { 
          ID
        }
        WHERE ((author.name, genre.name), 1) in (('foo', 1), ('bar', 2))`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
          left outer join bookshop.Genres as genre on genre.ID = Books.genre_ID
        {
          Books.ID
        }
        WHERE ((author.name, genre.name), 1) in (('foo', 1), ('bar', 2))`
      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('in having', () => {
    it('basic', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID } having author.name = 'Schiller'`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
        {
          Books.ID
        }
        HAVING author.name = 'Schiller'`
      expectCqn(transformed).to.equal(expected)
    })
    it('in list', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID
        }
        HAVING (author.name, 1) in ('foo', 'bar')`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
        {
          Books.ID
        }
        HAVING (author.name, 1) in ('foo', 'bar')`
      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('in group by', () => {
    it('basic', () => {
      const transformed = cqn4sql(cds.ql`
      SELECT from bookshop.Books as Books
      {
        ID
      }
      GROUP BY author.name`)
      const expected = cds.ql`
      SELECT from bookshop.Books as Books
        left outer join bookshop.Authors as author on author.ID = Books.author_ID
      {
        Books.ID
      }
      GROUP BY author.name`
      expectCqn(transformed).to.equal(expected)
    })
    it('path via wildcard', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        GROUP BY author.name`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
        {
          Books.createdAt,
          Books.createdBy,
          Books.modifiedAt,
          Books.modifiedBy,
          Books.ID,
          Books.anotherText,
          Books.title,
          Books.descr,
          Books.author_ID,
          Books.coAuthor_ID,
          Books.genre_ID,
          Books.stock,
          Books.price,
          Books.currency_code,
          Books.dedication_addressee_ID,
          Books.dedication_text,
          Books.dedication_sub_foo,
          Books.dedication_dedication,
          Books.coAuthor_ID_unmanaged
        }
        GROUP BY author.name`
      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('in order by', () => {
    it('basic', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID
        }
        ORDER BY author.name asc`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
        {
          Books.ID
        }
        ORDER BY author.name asc`
      expectCqn(transformed).to.equal(expected)
    })

    it('path via wildcard', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books.twin as twin
        ORDER BY author.name asc`)
      const expected = cds.ql`
        SELECT from bookshop.Books.twin as twin
          left outer join bookshop.Authors as author on author.ID = twin.author_ID
        {
          twin.ID,
          twin.author_ID,
          twin.stock
        }
        ORDER BY author.name asc`
      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('in subquery', () => {
    it('traverse exposed assoc from subquery', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from (select genre, ID from bookshop.Books as Books) as book
        {
          ID
        }
        GROUP BY genre.parent.ID, genre.parent.name`)
      const expected = cds.ql`
        SELECT from (select Books.genre_ID, Books.ID from bookshop.Books as Books) as book
          left join bookshop.Genres as genre on genre.ID = book.genre_ID
          left join bookshop.Genres as parent on parent.ID = genre.parent_ID
        {
          book.ID
        }
        GROUP BY parent.ID, parent.name`
      expectCqn(transformed).to.equal(expected)
    })

    it('subquery in from navigates to field, outer query uses the field', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from (
          SELECT from bookshop.Books as Books
          {
            author.name as author_name
          }
        ) as Bar
        {
          Bar.author_name
        }`)
      const expected = cds.ql`
        SELECT from (
          SELECT from bookshop.Books as Books
            left outer join bookshop.Authors as author on author.ID = Books.author_ID
          {
            author.name as author_name
          }
        ) as Bar
        {
          Bar.author_name
        }`
      expectCqn(transformed).to.equal(expected)
    })

    it('expose managed assoc in subquery in from, navigation to field in outer', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from (
          SELECT from bookshop.Books as Books
          {
            author
          }
        ) as Bar
        {
          Bar.author.name
        }`)
      const expected = cds.ql`
        SELECT from (
          SELECT from bookshop.Books as Books
          {
            Books.author_ID
          }
        ) as Bar
          left outer join bookshop.Authors as author on author.ID = Bar.author_ID
        {
          author.name as author_name
        }`
      expectCqn(transformed).to.equal(expected)
    })

    it('expose managed assoc in subquery with alias, navigate to field in outer', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from (
          SELECT from bookshop.Books as Books
          {
            author as a
          }
        ) as Bar
        {
          Bar.a.name
        }`)
      const expected = cds.ql`
        SELECT from (
          SELECT from bookshop.Books as Books
          {
            Books.author_ID as a_ID
          }
        ) as Bar
          left outer join bookshop.Authors as a on a.ID = Bar.a_ID
        {
          a.name as a_name
        }`
      expectCqn(transformed).to.equal(expected)
      // make sure that the subquery in the join is properly inferred
      expect(transformed.SELECT.from.args[0]).to.have.property('_target')
      expect(transformed.SELECT.from.args[0]).to.have.property('elements')
    })

    it('expose managed assoc in subquery with alias, navigate to field in outer (subquery also has joins)', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from (
          SELECT from bookshop.Books as Books
          {
            author.ID,
            author as a,
            author.name as author_name
          }
        ) as Bar
        {
          Bar.author_name,
          Bar.a.books.descr
        }`)
      const expected = cds.ql`
        SELECT from (
          SELECT from bookshop.Books as Books
            left outer join bookshop.Authors as author on author.ID = Books.author_ID
          {
            Books.author_ID,
            Books.author_ID as a_ID,
            author.name as author_name
          }
        ) as Bar
          left outer join bookshop.Authors as a on a.ID = Bar.a_ID
          left outer join bookshop.Books as books on books.author_ID = a.ID
        {
          Bar.author_name,
          books.descr as a_books_descr
        }`
      expectCqn(transformed).to.equal(expected)
    })

    it('subquery in column', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          title,
          (
            select from bookshop.Genres as Genres
            {
              parent.code
            } 
            WHERE Genres.ID = Books.genre.ID
          ) as pc
        }`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          Books.title,
          (
            select from bookshop.Genres as Genres
              left outer join bookshop.Genres as parent on parent.ID = Genres.parent_ID
            {
              parent.code as parent_code
            }
            WHERE Genres.ID = Books.genre_ID
          ) as pc
        }`
      expectCqn(transformed).to.equal(expected)
    })
  })
})
