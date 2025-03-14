'use strict'

const _cqn4sql = require('../../lib/cqn4sql')
function cqn4sql(q, model = cds.model) {
  return _cqn4sql(q, model)
}
const cds = require('@sap/cds')
const { expect } = cds.test

describe('Unfold expands on structure', () => {
  beforeAll(async () => {
    cds.model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })
  it('supports nested projections for structs', () => {
    let query = cds.ql`SELECT from bookshop.Books { ID, dedication { addressee } }`
    let transformed = cqn4sql(query)
    expect(transformed).to.deep.eql(
      cds.ql`SELECT from bookshop.Books as Books { Books.ID,
        Books.dedication_addressee_ID,
      }`,
    )
  })
  it('supports deeply nested projections for structs', () => {
    let query = cds.ql`SELECT from bookshop.Books { ID, dedication { addressee, sub { foo } } }`
    let transformed = cqn4sql(query)
    expect(transformed).to.deep.eql(
      cds.ql`SELECT from bookshop.Books as Books { Books.ID,
        Books.dedication_addressee_ID,
        Books.dedication_sub_foo,
      }`,
    )
  })
  it('supports deeply nested projections for structs w/ wildcard', () => {
    let query = cds.ql`SELECT from bookshop.Books { ID, dedication { addressee, sub { * } } }`
    let transformed = cqn4sql(query)
    expect(transformed).to.deep.eql(
      cds.ql`SELECT from bookshop.Books as Books {
        Books.ID,
        Books.dedication_addressee_ID,
        Books.dedication_sub_foo,
      }`,
    )
  })
  it('supports renaming', () => {
    let query = cds.ql`SELECT from bookshop.Books { ID as foo, dedication as bubu { addressee, sub { * } } }`
    let transformed = cqn4sql(query)
    expect(transformed).to.deep.eql(
      cds.ql`SELECT from bookshop.Books as Books {
        Books.ID as foo,
        Books.dedication_addressee_ID as bubu_addressee_ID,
        Books.dedication_sub_foo as bubu_sub_foo,
      }`,
    )
  })
  it('supports nested projections for structs w/ order by', () => {
    let query = cds.ql`SELECT from bookshop.Books { ID, dedication as bubu { addressee, sub { * } } } order by bubu.sub.foo`
    let transformed = cqn4sql(query)
    expect(transformed).to.deep.eql(
      cds.ql`SELECT from bookshop.Books as Books {
        Books.ID,
        Books.dedication_addressee_ID as bubu_addressee_ID,
        Books.dedication_sub_foo as bubu_sub_foo,
      } order by bubu_sub_foo`,
    )
  })

  it('supports nested projections for structs with wildcard select and respects order', () => {
    let query = cds.ql`SELECT from bookshop.Books { dedication {text, * } }`
    let transformed = cqn4sql(query)
    expect(transformed).to.deep.eql(
      cds.ql`SELECT from bookshop.Books as Books {
        Books.dedication_text,
        Books.dedication_addressee_ID,
        Books.dedication_sub_foo,
        Books.dedication_dedication,
      }`,
    )
  })
  it('supports nested projections for structs with wildcard select', () => {
    let query = cds.ql`SELECT from bookshop.Books { ID, dedication { * } }`
    let transformed = cqn4sql(query)
    expect(transformed).to.deep.eql(
      cds.ql`SELECT from bookshop.Books as Books { Books.ID,
        Books.dedication_addressee_ID,
        Books.dedication_text,
        Books.dedication_sub_foo,
        Books.dedication_dedication,
      }`,
    )
  })
  it('supports nested projections for structs with smart wildcard', () => {
    let query = cds.ql`SELECT from bookshop.Books { ID, dedication { *, 5 as text } }`
    let transformed = cqn4sql(query)
    expect(transformed).to.deep.eql(
      cds.ql`SELECT from bookshop.Books as Books {
        Books.ID,
        Books.dedication_addressee_ID,
        5 as dedication_text,
        Books.dedication_sub_foo,
        Books.dedication_dedication,
      }`,
    )
  })

  it('supports nested projections for structs with join relevant path expression', () => {
    let query = cds.ql`SELECT from bookshop.Books { ID, dedication { addressee.name } }`
    let transformed = cqn4sql(query)
    expect(transformed).to.deep.eql(
      cds.ql`SELECT from bookshop.Books as Books
          left outer join bookshop.Person as addressee on addressee.ID = Books.dedication_addressee_ID {
            Books.ID,
            addressee.name as dedication_addressee_name
      }`,
    )
  })
  it('supports nested projections for structs with join relevant path expression w/ infix filter', () => {
    let query = cds.ql`SELECT from bookshop.Books { ID, dedication { addressee[ID=42].name } }`
    let transformed = cqn4sql(query)
    expect(transformed).to.deep.eql(
      cds.ql`SELECT from bookshop.Books as Books
          left outer join bookshop.Person as addressee on addressee.ID = Books.dedication_addressee_ID and addressee.ID = 42 {
            Books.ID,
            addressee.name as dedication_addressee_name
      }`,
    )
  })
  it('nested projection of assoc within structured expand', () => {
    let query = cds.ql`SELECT from bookshop.Books {
                    ID,
                    dedication { text, addressee { name } }
                  }`
    let transformed = cqn4sql(query)
    expect(JSON.parse(JSON.stringify(transformed))).to.deep.eql(
      cds.ql`SELECT from bookshop.Books as Books {
            Books.ID,
            Books.dedication_text,
            (
              SELECT dedication_addressee.name
              from bookshop.Person as dedication_addressee
              where Books.dedication_addressee_ID = dedication_addressee.ID
            ) as dedication_addressee
      }`,
    )
  })

  it('handles smart wildcard and respects order', () => {
    let query = cds.ql`SELECT from bookshop.Books { dedication { 'first' as first, 'second' as sub, *, 5 as ![5], 'Baz' as text } }`
    let transformed = cqn4sql(query)
    expect(transformed).to.deep.eql(
      cds.ql`SELECT from bookshop.Books as Books {
        'first' as dedication_first,
        'second' as dedication_sub,
        Books.dedication_addressee_ID,
        'Baz' as dedication_text,
        Books.dedication_dedication,
        5 as dedication_5
      }`,
    )
  })

  it('structured expand within nested projection of assoc within structured expand', () => {
    let query = cds.ql`SELECT from bookshop.Books {
                    ID,
                    dedication { text, addressee { name, address { * } } }
                  }`
    let transformed = cqn4sql(query)
    expect(JSON.parse(JSON.stringify(transformed))).to.deep.eql(
      cds.ql`SELECT from bookshop.Books as Books {
            Books.ID,
            Books.dedication_text,
            (
              SELECT
                dedication_addressee.name,
                dedication_addressee.address_street,
                dedication_addressee.address_city
              from bookshop.Person as dedication_addressee
              where Books.dedication_addressee_ID = dedication_addressee.ID
            ) as dedication_addressee
      }`,
    )
  })
})
describe('Unfold expands on associations to special subselects', () => {
  let model
  beforeAll(async () => {
    cds.model = model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  // Expands along associations are translated to subqueries.
  // These subqueries may be invalid from SQL perspective, because
  // - they can select multiple columns
  // - they can return multiple rows
  it('rejects unmanaged association in infix filter of expand path', () => {
    expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { author[books.title = 'foo'] { name } }`, model)).to.throw(
      /Unexpected unmanaged association “books” in filter expression of “author”/,
    )
  })
  it('rejects non-fk access in infix filter of expand path', () => {
    expect(() =>
      cqn4sql(cds.ql`SELECT from bookshop.EStrucSibling { self[sibling.struc1 = 'foo'] { ID } }`, model),
    ).to.throw(/Only foreign keys of “sibling” can be accessed in infix filter/)
  })
  it('unfold expand, one field', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      author { name }
    }`
    const res = cqn4sql(q)
    expect(res.SELECT.columns[0].SELECT).to.have.property('expand').that.equals(true)
    expect(res.SELECT.columns[0].SELECT).to.have.property('one').that.equals(true)
    const expected = cds.ql`SELECT from bookshop.Books as Books {
      (
        SELECT from bookshop.Authors as author {
          author.name
        } where Books.author_ID = author.ID
      ) as author
    }`
    expect(JSON.parse(JSON.stringify(res)))
      .to.deep.equal(expected)
      .to.deep.equal({
        SELECT: {
          from: { ref: ['bookshop.Books'], as: 'Books' },
          columns: [
            {
              SELECT: {
                from: { ref: ['bookshop.Authors'], as: 'author' },
                columns: [{ ref: ['author', 'name'] }],
                where: [{ ref: ['Books', 'author_ID'] }, '=', { ref: ['author', 'ID'] }],
              },
              as: 'author',
            },
          ],
        },
      })
  })
  it('do not loose additional properties on expand column', () => {
    const q = {
      SELECT: {
        from: {
          ref: ['bookshop.Books'],
        },
        columns: [
          {
            ref: ['author'],
            expand: [
              {
                ref: ['name'],
              },
            ],
            limit: {
              offset: {
                val: 1,
              },
              rows: {
                val: 1,
              },
            },
            orderBy: [
              {
                ref: ['name'],
                sort: 'asc',
              },
            ],
          },
        ],
      },
    }

    const res = cqn4sql(q)
    const expected = cds.ql`SELECT from bookshop.Books as Books {
      (
        SELECT from bookshop.Authors as author {
          author.name
        }
        where Books.author_ID = author.ID
        order by name ASC
        limit 1
        offset 1
      ) as author
    }`
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(expected)
  })

  it('do not loose additional properties on expand column if defined in ref', () => {
    const q = cds.ql`SELECT from bookshop.Authors { books[order by price] { title } }`
    const res = cqn4sql(q)
    const expected = cds.ql`SELECT from bookshop.Authors as Authors {
      (
        SELECT from bookshop.Books as books {
          books.title
        }
        where Authors.ID = books.author_ID
        order by books.price
      ) as books
    }`
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(expected)
  })

  it('query modifiers in ref are combined with sibling properties to expand', () => {
    const q = {
      SELECT: {
        from: {
          ref: ['bookshop.Books'],
        },
        columns: [
          {
            ref: [{id: 'author', orderBy: [{ref:['dateOfBirth'], sort: 'desc'}]}],
            expand: [
              {
                ref: ['name'],
              },
            ],
            limit: {
              offset: {
                val: 1,
              },
              rows: {
                val: 1,
              },
            },
            // this order by is overwritten by the one in the ref
            orderBy: [
              {
                ref: ['dateOfDeath'],
                sort: 'asc',
              },
            ],
          },
        ],
      },
    }

    const res = cqn4sql(q)
    const expected = cds.ql`SELECT from bookshop.Books as Books {
      (
        SELECT from bookshop.Authors as author {
          author.name
        }
        where Books.author_ID = author.ID
        order by author.dateOfDeath asc, author.dateOfBirth desc
        limit 1
        offset 1
      ) as author
    }`
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(expected)
  })

  it('add where exists <assoc> shortcut to expand subquery where condition', () => {
    const q = {
      SELECT: {
        from: {
          ref: ['bookshop.Books'],
        },
        columns: [
          {
            ref: ['author'],
            expand: [
              {
                ref: ['name'],
              },
            ],
            where: ['exists', { ref: ['books', { id: 'author', where: [{ ref: ['name'] }, '=', { val: 'King' }] }] }],
            limit: {
              offset: {
                val: 1,
              },
              rows: {
                val: 1,
              },
            },
            orderBy: [
              {
                ref: ['name'],
                sort: 'asc',
              },
            ],
          },
        ],
      },
    }

    const expected = cds.ql`SELECT from bookshop.Books as Books {
      (
        SELECT from bookshop.Authors as author {
          author.name
        }
        where Books.author_ID = author.ID and
            exists ( SELECT 1 from bookshop.Books as books2 where
                books2.author_ID = author.ID and exists (
                  SELECT 1 from bookshop.Authors as author2 where
                    author2.ID = books2.author_ID and
                    author2.name = 'King'
                  )
              )
        order by name ASC
        limit 1
        offset 1
      ) as author
    }`

    const res = cqn4sql(q)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(expected)
  })

  it('unfold expand, make sure the prototype of the subquery is not polluted', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      author { name }
    }`
    const res = cqn4sql(q)
    expect(res.SELECT.columns[0].SELECT).to.not.have.property('ref')
    expect(res.SELECT.columns[0].SELECT).to.have.property('expand').that.equals(true)
  })

  it('enforce external alias to texts expand', () => {
    const q = cds.ql`SELECT from bookshop.Books as NotBooks {
      ID,
      texts { locale }
    }`
    const qx = cds.ql`SELECT from bookshop.Books as NotBooks {
      NotBooks.ID,
      (
        SELECT texts.locale
        from bookshop.Books.texts as texts
        where texts.ID = NotBooks.ID
      ) as texts
    }`
    const res = cqn4sql(q)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })

  it('unfold expand, one field w/ infix filter', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      author[name='King' or name like '%Sanderson'] { name }
    }`
    const qx = cds.ql`SELECT from bookshop.Books as Books {
      (SELECT author.name from bookshop.Authors as author
        where Books.author_ID = author.ID and (author.name = 'King' or author.name like '%Sanderson')) as author
    }`
    const res = cqn4sql(q)
    expect(res.SELECT.columns[0].SELECT).to.have.property('expand').that.equals(true)
    expect(res.SELECT.columns[0].SELECT).to.have.property('one').that.equals(true)
    expect(JSON.parse(JSON.stringify(res))).to.deep.eql(qx)
  })

  it('backlink with simple condition AND backlink', () => {
    let query = cqn4sql(cds.ql`
      SELECT from bookshop.SoccerTeams {
        goalKeeper { name }
      }
    `)
    let expected = cds.ql`
      SELECT from bookshop.SoccerTeams as SoccerTeams {
        (
          SELECT from bookshop.SoccerPlayers as goalKeeper {
            goalKeeper.name
          } where goalKeeper.jerseyNumber = 1 and (SoccerTeams.ID = goalKeeper.team_ID)
        ) as goalKeeper
      }
    `
    expect(JSON.parse(JSON.stringify(query))).to.eql(expected)
  })

  // TODO: aliases of outer query needs to be considered
  // still valid sql in this case
  it('unfold expand, with subquery in expand', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      author { name, (select title from bookshop.Books) as book }
    }`
    const qx = cds.ql`SELECT from bookshop.Books as Books {
      (SELECT
          author.name,
          (select Books2.title from bookshop.Books as Books2) as book
        from bookshop.Authors as author
        where Books.author_ID = author.ID) as author
    }`
    const res = cqn4sql(q)
    expect(res.SELECT.columns[0].SELECT).to.have.property('expand').that.equals(true)
    expect(res.SELECT.columns[0].SELECT).to.have.property('one').that.equals(true)
    expect(JSON.parse(JSON.stringify(res))).to.deep.eql(qx)
  })

  it('correctly builds correlated subquery if selecting from subquery', () => {
    const q = cds.ql`SELECT from (select author from bookshop.Books) as book {
      author { name }
    }`
    const qx = cds.ql`SELECT from (select Books.author_ID from bookshop.Books as Books) as book {
      (SELECT
          author.name
        from bookshop.Authors as author
        where book.author_ID = author.ID) as author
    }`
    const res = cqn4sql(q)
    expect(JSON.parse(JSON.stringify(res))).to.deep.eql(qx)
  })

  it('unfold expand, several fields with alias', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      author { name, dateOfBirth as dob, placeOfBirth as pob}
    }`
    const qx = cds.ql`SELECT from bookshop.Books as Books {
      (SELECT author.name, author.dateOfBirth as dob, author.placeOfBirth as pob
         from bookshop.Authors as author where Books.author_ID = author.ID) as author
    }`
    const res = cqn4sql(q)
    expect(res.SELECT.columns[0].SELECT).to.have.property('expand').that.equals(true)
    expect(res.SELECT.columns[0].SELECT).to.have.property('one').that.equals(true)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })

  it('unfold expand, several fields with expressions', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      author { name, substring(placeOfBirth, 1, 1) as pob }
    }`
    const qx = cds.ql`SELECT from bookshop.Books as Books {
      (SELECT author.name, substring(author.placeOfBirth, 1, 1) as pob
         from bookshop.Authors as author where Books.author_ID = author.ID) as author
    }`
    const res = cqn4sql(q)
    expect(res.SELECT.columns[0].SELECT).to.have.property('expand').that.equals(true)
    expect(res.SELECT.columns[0].SELECT).to.have.property('one').that.equals(true)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })

  it('unfold expand, structured field', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      author { name, address }
    }`
    const qx = cds.ql`SELECT from bookshop.Books as Books {
      ( SELECT
        author.name, author.address_street, author.address_city
        from bookshop.Authors as author where Books.author_ID = author.ID) as author
    }`
    const res = cqn4sql(q)
    expect(res.SELECT.columns[0].SELECT).to.have.property('expand').that.equals(true)
    expect(res.SELECT.columns[0].SELECT).to.have.property('one').that.equals(true)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })
  it('unfold expand, structured field with alias', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      author { name, address as BUBU }
    }`
    const qx = cds.ql`SELECT from bookshop.Books as Books {
      ( SELECT
        author.name, author.address_street as BUBU_street, author.address_city as BUBU_city
        from bookshop.Authors as author where Books.author_ID = author.ID) as author
    }`
    const res = cqn4sql(q)
    expect(res.SELECT.columns[0].SELECT).to.have.property('expand').that.equals(true)
    expect(res.SELECT.columns[0].SELECT).to.have.property('one').that.equals(true)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })

  it('unfold expand, *', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      author { * }
    }`
    const qx = cds.ql`SELECT from bookshop.Books as Books {
      ( SELECT
        author.createdAt, author.createdBy, author.modifiedAt, author.modifiedBy,
        author.ID, author.name, author.dateOfBirth, author.dateOfDeath, author.placeOfBirth, author.placeOfDeath,
        author.address_street, author.address_city
        from bookshop.Authors as author where Books.author_ID = author.ID) as author
    }`
    const res = cqn4sql(q)
    expect(res.SELECT.columns[0].SELECT).to.have.property('expand').that.equals(true)
    expect(res.SELECT.columns[0].SELECT).to.have.property('one').that.equals(true)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })

  // explicit alias for struc name is also used as table alias for subquery
  it('unfold expand, with association alias', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      author as a { name }
    }`
    const qx = cds.ql`SELECT from bookshop.Books as Books {
      (SELECT a.name from bookshop.Authors as a where Books.author_ID  = a.ID) as a
    }`
    const res = cqn4sql(q)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })

  // if the provided alias needs to be renamed when used as table alias, the alias for the element
  // must not change
  it('unfold expand, with duplicate association alias', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      author as books { name }
    }`
    const qx = cds.ql`SELECT from bookshop.Books as Books {
      (SELECT books2.name from bookshop.Authors as books2 where Books.author_ID = books2.ID) as books
    }`
    const res = cqn4sql(q)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })

  it('unfold expand, two expands', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      author as a1 { name },
      author as a2 { name }
    }`
    const qx = cds.ql`SELECT from bookshop.Books as Books {
      (SELECT a1.name from bookshop.Authors as a1
        where Books.author_ID = a1.ID) as a1,
      (SELECT a2.name from bookshop.Authors as a2
        where Books.author_ID = a2.ID) as a2
    }`
    const res = cqn4sql(q)
    expect(res.SELECT.columns[0].SELECT).to.have.property('expand').that.equals(true)
    expect(res.SELECT.columns[0].SELECT).to.have.property('one').that.equals(true)
    expect(res.SELECT.columns[1].SELECT).to.have.property('expand').that.equals(true)
    expect(res.SELECT.columns[1].SELECT).to.have.property('one').that.equals(true)
    expect(JSON.parse(JSON.stringify(res))).to.deep.eql(qx)
  })

  it('unfold expand, with path expressions in nested projection', () => {
    const q = cds.ql`SELECT from bookshop.Authors {
      books {
        title,
        genre.name
      }
    }`
    const qx = cds.ql`SELECT from bookshop.Authors as Authors {
      (SELECT books.title, genre.name AS genre_name
        FROM bookshop.Books AS books
        LEFT JOIN bookshop.Genres AS genre ON genre.ID = books.genre_ID
        WHERE Authors.ID = books.author_ID
      ) as books
    }`
    const res = cqn4sql(q)
    expect(res.SELECT.columns[0].SELECT).to.have.property('expand').that.equals(true)
    expect(res.SELECT.columns[0].SELECT).to.have.property('one').that.equals(false)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })

  it('unfold expand, expand after association', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      title,
      author.books { title }
    }`
    const qx = cds.ql`SELECT from bookshop.Books as Books
      left outer join bookshop.Authors as author on author.ID = Books.author_ID
      {
        Books.title,
        (SELECT author_books.title from bookshop.Books as author_books where author.ID = author_books.author_ID) as author_books
    }`
    const res = cqn4sql(q)
    expect(res.SELECT.columns[1].SELECT).to.have.property('expand').that.equals(true)
    expect(res.SELECT.columns[1].SELECT).to.have.property('one').that.equals(false)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })

  // TODO (SMW) new test
  it('unfold expand, expand after association (2)', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      title,
      author.name,
      author.books { title }
    }`
    const qx = cds.ql`SELECT from bookshop.Books as Books
      left outer join bookshop.Authors as author on author.ID = Books.author_ID
      {
        Books.title,
        author.name as author_name,
        (SELECT author_books.title from bookshop.Books as author_books where author.ID = author_books.author_ID) as author_books
    }`
    const res = cqn4sql(q)
    expect(res.SELECT.columns[2].SELECT).to.have.property('expand').that.equals(true)
    expect(res.SELECT.columns[2].SELECT).to.have.property('one').that.equals(false)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })

  it('unfold expand, expand after association (3) with infix filter on last step', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      title,
      author.name,
      author.books[title = 'foo'] { title }
    }`
    const qx = cds.ql`SELECT from bookshop.Books as Books
      left outer join bookshop.Authors as author on author.ID = Books.author_ID
      {
        Books.title,
        author.name as author_name,
        (SELECT author_books.title from bookshop.Books as author_books where author.ID = author_books.author_ID and author_books.title = 'foo') as author_books
    }`
    const res = cqn4sql(q)
    expect(res.SELECT.columns[2].SELECT).to.have.property('expand').that.equals(true)
    expect(res.SELECT.columns[2].SELECT).to.have.property('one').that.equals(false)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })

  it('unfold expand, expand after association (4) with infix filter in intermediate step', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      title,
      author.name,
      Books.author.books.genre[name = 'foo'] { name }
    }`
    const qx = cds.ql`SELECT from bookshop.Books as Books
      left outer join bookshop.Authors as author on author.ID = Books.author_ID
      left outer join bookshop.Books as books2 on books2.author_ID = author.ID
      {
        Books.title,
        author.name as author_name,
        (SELECT author_books_genre.name from bookshop.Genres as author_books_genre where books2.genre_ID = author_books_genre.ID and author_books_genre.name = 'foo') as author_books_genre
    }`
    const res = cqn4sql(q)
    expect(res.SELECT.columns[2].SELECT).to.have.property('expand').that.equals(true)
    expect(res.SELECT.columns[2].SELECT).to.have.property('one').that.equals(true)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })
  it('unfold expand, expand after association (5) with infix filter on first step', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      title,
      author[name='Sanderson'].name,
      author[name='Sanderson'].books.genre { name }
    }`
    const qx = cds.ql`SELECT from bookshop.Books as Books
      left outer join bookshop.Authors as author on author.ID = Books.author_ID and author.name = 'Sanderson'
      left outer join bookshop.Books as books2 on books2.author_ID = author.ID
      {
        Books.title,
        author.name as author_name,
        (SELECT author_books_genre.name from bookshop.Genres as author_books_genre where books2.genre_ID = author_books_genre.ID) as author_books_genre
    }`
    const res = cqn4sql(q)
    expect(res.SELECT.columns[2].SELECT).to.have.property('expand').that.equals(true)
    expect(res.SELECT.columns[2].SELECT).to.have.property('one').that.equals(true)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })

  it('unfold expand, expand after association (6) with assoc as key', () => {
    const q = cds.ql`SELECT from bookshop.AssocAsKey {
      foo,
      toAuthor.books { title }
    }`
    const qx = cds.ql`SELECT from bookshop.AssocAsKey as AssocAsKey
    left outer join bookshop.Authors as toAuthor on toAuthor.ID = AssocAsKey.toAuthor_ID
      {
        AssocAsKey.foo,
        (
          SELECT toAuthor_books.title
            from bookshop.Books as toAuthor_books
            where toAuthor.ID = toAuthor_books.author_ID
        ) as toAuthor_books
    }`
    const res = cqn4sql(q)
    expect(res.SELECT.columns[1].SELECT).to.have.property('expand').that.equals(true)
    expect(res.SELECT.columns[1].SELECT).to.have.property('one').that.equals(false)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })

  // TODO clarify if it would be okay to only forbid addressing to many expands
  it('unfold expand // reference in order by is NOT referring to expand column', () => {
    const input = cds.ql`SELECT from bookshop.Books.twin { author { name } } order by author.name asc`
    let qx = cds.ql`SELECT from bookshop.Books.twin as twin
    left outer join bookshop.Authors as author on author.ID = twin.author_ID
    {
      (
        select author2.name from bookshop.Authors as author2
        where twin.author_ID = author2.ID
      ) as author
    } order by author.name asc
  `
    let res = cqn4sql(input)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })

  it('unfold expand within structure', () => {
    const q = cds.ql`SELECT from bookshop.DeepRecursiveAssoc {
      ID,
      one.two.three.toSelf { ID }
    }`
    const qx = cds.ql`SELECT from bookshop.DeepRecursiveAssoc as DeepRecursiveAssoc {
        DeepRecursiveAssoc.ID,
        (
          SELECT one_two_three_toSelf.ID
            from bookshop.DeepRecursiveAssoc as one_two_three_toSelf
            where DeepRecursiveAssoc.one_two_three_toSelf_ID = one_two_three_toSelf.ID
        ) as one_two_three_toSelf
    }`
    const res = cqn4sql(q)
    expect(res.SELECT.columns[1].SELECT).to.have.property('expand').that.equals(true)
    expect(res.SELECT.columns[1].SELECT).to.have.property('one').that.equals(true)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })
  it('unfold expand within structure (2) + joins', () => {
    const q = cds.ql`SELECT from bookshop.DeepRecursiveAssoc {
      ID,
      one.two.three.toSelf.one.two.three.toSelf { ID }
    }`
    const qx = cds.ql`SELECT from bookshop.DeepRecursiveAssoc as DeepRecursiveAssoc
    left outer join bookshop.DeepRecursiveAssoc as toSelf on
      toSelf.ID = DeepRecursiveAssoc.one_two_three_toSelf_ID
    {
        DeepRecursiveAssoc.ID,
        (
          SELECT one_two_three_toSelf_one_two_three_toSelf.ID
            from bookshop.DeepRecursiveAssoc as one_two_three_toSelf_one_two_three_toSelf
            where toSelf.one_two_three_toSelf_ID = one_two_three_toSelf_one_two_three_toSelf.ID
        ) as one_two_three_toSelf_one_two_three_toSelf
    }`
    const res = cqn4sql(q)
    expect(res.SELECT.columns[1].SELECT).to.have.property('expand').that.equals(true)
    expect(res.SELECT.columns[1].SELECT).to.have.property('one').that.equals(true)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })

  it('unfold nested expands', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      author {
        books {
          genre {
            name
          }
        }
      }
    }`
    const qx = cds.ql`SELECT from bookshop.Books as Books {
      ( SELECT
          ( SELECT
            ( SELECT genre.name
              FROM bookshop.Genres as genre WHERE books2.genre_ID = genre.ID
            ) as genre
            FROM bookshop.Books AS books2 WHERE author.ID = books2.author_ID
          ) as books
        FROM bookshop.Authors as author WHERE Books.author_ID = author.ID
      ) as author
    }`
    const res = cqn4sql(q)
    // author
    expect(res.SELECT.columns[0].SELECT).to.have.property('expand').that.equals(true)
    expect(res.SELECT.columns[0].SELECT).to.have.property('one').that.equals(true)
    // books
    expect(res.SELECT.columns[0].SELECT.columns[0].SELECT).to.have.property('expand').that.equals(true)
    expect(res.SELECT.columns[0].SELECT.columns[0].SELECT).to.have.property('one').that.equals(false)
    // genre
    expect(res.SELECT.columns[0].SELECT.columns[0].SELECT.columns[0].SELECT)
      .to.have.property('expand')
      .that.equals(true)
    expect(res.SELECT.columns[0].SELECT.columns[0].SELECT.columns[0].SELECT).to.have.property('one').that.equals(true)

    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })

  it('unfold expand, with assoc in FROM', () => {
    const q = cds.ql`SELECT from bookshop.Books:author {
      name,
      books { title }
    }`
    const qx = cds.ql`SELECT from bookshop.Authors as author {
      author.name,
      (SELECT books2.title from bookshop.Books as books2
        where author.ID = books2.author_ID) as books
    } where exists (SELECT 1 from bookshop.Books as Books where Books.author_ID = author.ID)`
    const res = cqn4sql(q)
    expect(res.SELECT.columns[1].SELECT).to.have.property('expand').that.equals(true)
    expect(res.SELECT.columns[1].SELECT).to.have.property('one').that.equals(false)
    expect(JSON.parse(JSON.stringify(res))).to.deep.eql(qx)
  })
  it('expand on assoc respects smart wildcard rules', () => {
    const q = cds.ql`SELECT from bookshop.Authors {
      name,
      books { 'first' as first, 'second' as ID, *, 'third' as createdAt, 'last' as last }
    }`
    const qx = cds.ql`SELECT from bookshop.Authors as Authors {
      Authors.name,
      (SELECT
        'first' as first,
        'second' as ID,
        'third' as createdAt,
        books.createdBy,
        books.modifiedAt,
        books.modifiedBy,
        books.anotherText,
        books.title,
        books.descr,
        books.author_ID,
        books.coAuthor_ID,
        books.genre_ID,
        books.stock,
        books.price,
        books.currency_code,
        books.dedication_addressee_ID,
        books.dedication_text,
        books.dedication_sub_foo,
        books.dedication_dedication,
        books.coAuthor_ID_unmanaged,
        'last' as last
        from bookshop.Books as books
        where Authors.ID = books.author_ID
      ) as books
    }`
    const res = cqn4sql(q)
    expect(res.SELECT.columns[1].SELECT).to.have.property('expand').that.equals(true)
    expect(res.SELECT.columns[1].SELECT).to.have.property('one').that.equals(false)
    expect(JSON.parse(JSON.stringify(res))).to.deep.eql(qx)
  })

  it('correctly calculates aliases for refs of on condition within xpr', () => {
    const q = cds.ql`SELECT from bookshop.WorklistItems {
      ID,
      releaseChecks {
        ID,
        detailsDeviations {
          ID
        }
      }
    }`
    const expected = cds.ql`SELECT from bookshop.WorklistItems as WorklistItems {
      WorklistItems.ID,
      (
        SELECT from bookshop.WorklistItem_ReleaseChecks as releaseChecks {
          releaseChecks.ID,
          (
            SELECT from bookshop.QualityDeviations as detailsDeviations {
              detailsDeviations.ID
            } where detailsDeviations.material_ID  = releaseChecks.parent_releaseDecisionTrigger_batch_material_ID
            and (
                    detailsDeviations.batch_ID = '*'
                or detailsDeviations.batch_ID = releaseChecks.parent_releaseDecisionTrigger_batch_ID
            )
            and detailsDeviations.snapshotHash = releaseChecks.snapshotHash
          ) as detailsDeviations
        } where releaseChecks.parent_ID = WorklistItems.ID
            and releaseChecks.parent_snapshotHash = WorklistItems.snapshotHash
      ) as releaseChecks
    }
    `
    expect(JSON.parse(JSON.stringify(cqn4sql(q)))).to.deep.eql(expected)
  })

  it('ignores expands which target ”@cds.persistence.skip”', () => {
    const q = cds.ql`SELECT from bookshop.NotSkipped {
      ID, skipped { text }
    }`
    const qx = cds.ql`SELECT from bookshop.NotSkipped as NotSkipped {
      NotSkipped.ID
    }`
    const res = cqn4sql(q)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })
  it('ignores expand if assoc in path expression has target ”@cds.persistence.skip”', () => {
    const q = cds.ql`SELECT from bookshop.NotSkipped {
      ID, skipped.notSkipped { text }
    }`
    const qx = cds.ql`SELECT from bookshop.NotSkipped as NotSkipped {
      NotSkipped.ID
    }`
    const res = cqn4sql(q)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })
  describe('anonymous expand', () => {
    it('scalar elements', () => {
      const q = cds.ql`SELECT from bookshop.Books {
        ID,
        {
          title,
          descr,
          price
        } as bookInfos
      }`
      const qx = cds.ql`SELECT from bookshop.Books as Books {
        Books.ID,
        Books.title as bookInfos_title,
        Books.descr as bookInfos_descr,
        Books.price as bookInfos_price
      }`
      const res = cqn4sql(q)
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
    })
    it('scalar elements, structure with renaming and association', () => {
      const q = cds.ql`SELECT from bookshop.Books {
        ID,
        {
          title,
          author,
          dedication.text as widmung,
          dedication.sub as deep
        } as bookInfos
      }`
      const qx = cds.ql`SELECT from bookshop.Books as Books {
        Books.ID,
        Books.title as bookInfos_title,
        Books.author_ID as bookInfos_author_ID,
        Books.dedication_text as bookInfos_widmung,
        Books.dedication_sub_foo as bookInfos_deep_foo
      }`
      const res = cqn4sql(q)
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
    })
    it('mixed with inline', () => {
      const q = cds.ql`SELECT from bookshop.Books {
        ID,
        {
          dedication.{
            *
          }
        } as bookInfos
      }`
      const qx = cds.ql`SELECT from bookshop.Books as Books {
        Books.ID,
        Books.dedication_addressee_ID as bookInfos_dedication_addressee_ID,
        Books.dedication_text as bookInfos_dedication_text,
        Books.dedication_sub_foo as bookInfos_dedication_sub_foo,
        Books.dedication_dedication as bookInfos_dedication_dedication,
      }`
      const res = cqn4sql(q)
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
    })
    it('join relevant association', () => {
      const q = cds.ql`SELECT from bookshop.Books {
        ID,
        {
          author.name
        } as bookInfos
      }`
      const qx = cds.ql`SELECT from bookshop.Books as Books
        left join bookshop.Authors as author on author.ID = Books.author_ID
      {
        Books.ID,
        author.name as bookInfos_author_name,
      }`
      const res = cqn4sql(q)
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
    })
  })
  describe('comparisons of associations in on condition of elements needs to be expanded', () => {
    let model
    beforeAll(async () => {
      model = cds.model = await cds.load(__dirname + '/A2J/schema').then(cds.linked)
    })

    it('assoc comparison needs to be expanded in on condition calculation', () => {
      const query = cqn4sql(cds.ql`SELECT from a2j.Foo { ID, buz { foo } }`, model)
      const expected = cds.ql`
        SELECT from a2j.Foo as Foo {
          Foo.ID,
          (
            SELECT buz.foo_ID from a2j.Buz as buz
              where (buz.bar_ID = Foo.bar_ID AND buz.bar_foo_ID = Foo.bar_foo_ID) and buz.foo_ID = Foo.ID
          ) as buz
        }`
      expect(JSON.parse(JSON.stringify(query))).to.eql(expected)
    })
    it('unmanaged association path traversal in on condition needs to be flattened', () => {
      const query = cqn4sql(cds.ql`SELECT from a2j.Foo { ID, buzUnmanaged { foo } }`, model)
      const expected = cds.ql`
        SELECT from a2j.Foo as Foo {
          Foo.ID,
          (
            SELECT buzUnmanaged.foo_ID from a2j.Buz as buzUnmanaged
              where buzUnmanaged.bar_foo_ID = Foo.bar_foo_ID and buzUnmanaged.bar_ID = Foo.bar_ID and buzUnmanaged.foo_ID = Foo.ID
          ) as buzUnmanaged
        }`
      expect(JSON.parse(JSON.stringify(query))).to.eql(expected)
    })
  })
  it('nested expand with multiple conditions', async () => {
    // innermost expand on association with backlink plus additional condition
    // must be properly linked
    const model = await cds.load(__dirname + '/model/collaborations').then(cds.linked)
    const q = cds.ql`
      SELECT from Collaborations {
        id,
        leads {
          id
        },
        subCollaborations {
          id,
          leads {
            id
          }
        }
      }
    `
    let transformed = cqn4sql(q, cds.compile.for.nodejs(JSON.parse(JSON.stringify(model))))
    expect(JSON.parse(JSON.stringify(transformed))).to.deep.eql(cds.ql`
      SELECT from Collaborations as Collaborations {
        Collaborations.id,
        (
          SELECT from CollaborationLeads as leads {
            leads.id
          } where ( Collaborations.id = leads.collaboration_id ) and leads.isLead = true
        ) as leads,
        (
          SELECT from SubCollaborations as subCollaborations {
            subCollaborations.id,
            (
              SELECT from SubCollaborationAssignments as leads2 {
                leads2.id
              } where ( subCollaborations.id = leads2.subCollaboration_id ) and leads2.isLead = true
            ) as leads
          } where Collaborations.id = subCollaborations.collaboration_id
        ) as subCollaborations
      }
    `)
  })
})

describe('Expands with aggregations are special', () => {
  let model
  beforeAll(async () => {
    cds.model = model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  it('simple aggregation', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      ID,
      Books.author { name }
    } group by author.name`

    const qx = cds.ql`SELECT from bookshop.Books as Books left join bookshop.Authors as author on author.ID = Books.author_ID {
      Books.ID,
      (SELECT from DUMMY { author.name as name }) as author
    } group by author.name`
    qx.SELECT.columns[1].SELECT.from = null
    const res = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })

  it('aggregation with mulitple path steps', () => {
    const q = cds.ql`SELECT from bookshop.Intermediate {
      ID,
      toAssocWithStructuredKey { toStructuredKey { second } }
    } group by toAssocWithStructuredKey.toStructuredKey.second`

    const qx = cds.ql`SELECT from bookshop.Intermediate as Intermediate
    left join bookshop.AssocWithStructuredKey as toAssocWithStructuredKey
      on toAssocWithStructuredKey.ID = Intermediate.toAssocWithStructuredKey_ID
    {
      Intermediate.ID,
      (SELECT from DUMMY {
        (SELECT from DUMMY {
          toAssocWithStructuredKey.toStructuredKey_second as second 
        }) as toStructuredKey
      }) as toAssocWithStructuredKey
    } group by toAssocWithStructuredKey.toStructuredKey_second`
    qx.SELECT.columns[1].SELECT.from = null
    qx.SELECT.columns[1].SELECT.columns[0].SELECT.from = null
    const res = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })
  it.skip('simple aggregation expand ref wrapped in func', () => {
    // TODO: how to detect the nested ref?
    const q = cds.ql`SELECT from bookshop.Books {
      ID,
      Books.author { toLower(name) as lower }
    } group by author.name`

    const qx = cds.ql`SELECT from bookshop.Books as Books left join bookshop.Authors as author on author.ID = Books.author_ID {
      Books.ID,
      (SELECT from DUMMY { toLower(author.name) as name }) as author
    } group by author.name`
    qx.SELECT.columns[1].SELECT.from = null

    const res = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })

  it('wildcard expand vanishes for aggregations', () => {
    const q = cds.ql`SELECT from bookshop.TestPublisher {
      ID,
      texts { publisher {*} }
    } group by ID, publisher.structuredKey_ID, publisher.title`

    const qx = cds.ql`SELECT from bookshop.TestPublisher as TestPublisher
    left join bookshop.Publisher as publisher on publisher.structuredKey_ID = TestPublisher.publisher_structuredKey_ID {
      TestPublisher.ID
    } group by TestPublisher.ID, TestPublisher.publisher_structuredKey_ID, publisher.title`
    // the key is not flat in the model so we use a flat csn for this test
    const res = cqn4sql(q, cds.compile.for.nodejs(model))
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })

  it('aggregation with structure', () => {
    const q = cds.ql`SELECT from bookshop.Authors as Authors {
      ID,
      books { dedication }
    } group by books.dedication`

    const qx = cds.ql`SELECT from bookshop.Authors as Authors left join bookshop.Books as books on books.author_ID = Authors.ID {
      Authors.ID,
      (SELECT from DUMMY { 
        books.dedication_addressee_ID as dedication_addressee_ID,
        books.dedication_text as dedication_text,
        books.dedication_sub_foo as dedication_sub_foo,
        books.dedication_dedication as dedication_dedication
      }) as books
    } group by books.dedication_addressee_ID, books.dedication_text, books.dedication_sub_foo, books.dedication_dedication`
    qx.SELECT.columns[1].SELECT.from = null
    const res = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })
  it('optimized foreign key access', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      ID,
      Books.author { name, ID }
    } group by author.name, author.ID`

    const qx = cds.ql`SELECT from bookshop.Books as Books left join bookshop.Authors as author on author.ID = Books.author_ID {
      Books.ID,
      (SELECT from DUMMY { author.name as name, Books.author_ID as ID }) as author
    } group by author.name, Books.author_ID`
    qx.SELECT.columns[1].SELECT.from = null
    const res = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })
  it('foreign key access renamed', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      ID,
      Books.author { name, ID as foo }
    } group by author.name, author.ID`

    const qx = cds.ql`SELECT from bookshop.Books as Books left join bookshop.Authors as author on author.ID = Books.author_ID {
      Books.ID,
      (SELECT from DUMMY { author.name as name, Books.author_ID as foo }) as author
    } group by author.name, Books.author_ID`
    qx.SELECT.columns[1].SELECT.from = null
    const res = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })
  it('non optimized foreign key access with filters', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      ID,
      Books.author[ID = 201] { name, ID }
    } group by author[ID = 201].name, author[ID = 201].ID`

    const qx = cds.ql`SELECT from bookshop.Books as Books
      left join bookshop.Authors as author on author.ID = Books.author_ID and author.ID = 201
    {
      Books.ID,
      (SELECT from DUMMY { author.name as name, author.ID as ID}) as author
    } group by author.name, author.ID`
    qx.SELECT.columns[1].SELECT.from = null
    const res = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })
  it('expand path with filter must be an exact match in group by', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      Books.ID,
      author[name='King'] { name }
    } group by author[name='King'].name`

    const qx = cds.ql`SELECT from bookshop.Books as Books
    left join bookshop.Authors as author on author.ID = Books.author_ID and author.name = 'King' {
      Books.ID,
      (SELECT from DUMMY { author.name as name }) as author
    } group by author.name`
    qx.SELECT.columns[1].SELECT.from = null
    const res = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })

  it('with multiple expands', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      ID,
      Books.author { name },
      genre { name }
    } group by author.name, genre.name`

    const qx = cds.ql`SELECT from bookshop.Books as Books
    left join bookshop.Authors as author on author.ID = Books.author_ID
    left join bookshop.Genres as genre on genre.ID = Books.genre_ID
    {
      Books.ID,
      (SELECT from DUMMY { author.name as name}) as author,
      (SELECT from DUMMY { genre.name as name}) as genre
    } group by author.name, genre.name`
    qx.SELECT.columns[1].SELECT.from = null
    qx.SELECT.columns[2].SELECT.from = null
    const res = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })
  it('with nested expands', () => {
    const q = cds.ql`SELECT from bookshop.Genres {
      ID,
      Genres.parent { parent { name } },
    } group by parent.parent.name`

    const qx = cds.ql`SELECT from bookshop.Genres as Genres
    left join bookshop.Genres as parent on parent.ID = Genres.parent_ID
    left join bookshop.Genres as parent2 on parent2.ID = parent.parent_ID
    {
      Genres.ID,
      (
        SELECT from DUMMY {
          (SELECT from DUMMY { parent2.name as name }) as parent
        }
      ) as parent,
    } group by parent2.name`
    qx.SELECT.columns[1].SELECT.from = null
    qx.SELECT.columns[1].SELECT.columns[0].SELECT.from = null
    const res = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })
  it('with nested expands and non-nested sibling', () => {
    const q = cds.ql`SELECT from bookshop.Genres {
      ID,
      Genres.parent { parent { name }, name },
    } group by parent.parent.name, parent.name`

    const qx = cds.ql`SELECT from bookshop.Genres as Genres
    left join bookshop.Genres as parent on parent.ID = Genres.parent_ID
    left join bookshop.Genres as parent2 on parent2.ID = parent.parent_ID
    {
      Genres.ID,
      (
        SELECT from DUMMY {
          (SELECT from DUMMY { parent2.name as name}) as parent,
          parent.name as name
        }
      ) as parent,
    } group by parent2.name, parent.name`
    qx.SELECT.columns[1].SELECT.from = null
    qx.SELECT.columns[1].SELECT.columns[0].SELECT.from = null
    const res = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })

  // negative tests
  it('simple path not part of group by', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      ID,
      Books.author { name, ID }
    } group by author.name`

    expect(() => cqn4sql(q, model)).to.throw(/The expanded column "author.ID" must be part of the group by clause/)
  })
  it('nested path not part of group by', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      ID,
      Books.author { books {title}, ID }
    } group by author.ID`

    expect(() => cqn4sql(q, model)).to.throw(
      /The expanded column "author.books.title" must be part of the group by clause/,
    )
  })
  it('deeply nested path not part of group by', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      ID,
      Books.author { books { author { name } } , ID }
    } group by author.ID`

    expect(() => cqn4sql(q, model)).to.throw(
      /The expanded column "author.books.author.name" must be part of the group by clause/,
    )
  })

  it('expand path with filter must be an exact match in group by', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      Books.ID,
      author[name='King'] { name }
    } group by author.name`

    expect(() => cqn4sql(q, model)).to.throw(
      `The expanded column "author[{"ref":["name"]},"=",{"val":"King"}].name" must be part of the group by clause`,
    )
  })
  it('expand path with filter must be an exact match in group by (2)', () => {
    const q = cds.ql`SELECT from bookshop.Books {
      Books.ID,
      author { name }
    } group by author[name='King'].name`

    expect(() => cqn4sql(q, model)).to.throw(`The expanded column "author.name" must be part of the group by clause`)
  })
})
// the tests in here are a copy of the tests in `./inline.test.js`
// and should behave exactly the same.
// `.inline` and `.expand` on a `struct` are semantically equivalent.
describe('expand on structure part II', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await await cds.load(`${__dirname}/model/nestedProjections`).then(cds.linked)
  })

  it('simple structural expansion', () => {
    let expandQuery = cds.ql`select from Employee {
      office {
        floor,
        room
      }
    }`

    let expected = cds.ql`select from Employee as Employee {
      Employee.office_floor,
      Employee.office_room
    }`
    expect(cqn4sql(expandQuery, model)).to.eql(expected)
  })
  it('structural expansion with path expression', () => {
    let expandQuery = cds.ql`select from Employee {
      office {
        floor,
        building.name
      }
    }`
    let expected = cds.ql`select from Employee as Employee
    left join Building as building on building.id = Employee.office_building_id
    {
      Employee.office_floor,
      building.name as office_building_name
    }`
    expect(cqn4sql(expandQuery, model)).to.eql(expected)
  })

  it('deep expand', () => {
    let expandQuery = cds.ql`select from Employee {
          office {
            floor,
            address {
              city,
              street
            }
          }
    }`
    let expected = cds.ql`SELECT from Employee as Employee {
        Employee.office_floor,
        Employee.office_address_city,
        Employee.office_address_street
    }`
    expect(cqn4sql(expandQuery, model)).to.eql(expected)
  })

  it('multi expand with star - foreign key must survive in flat mode', () => {
    let expandQuery = cds.ql`select from Employee {
        *,
        department {
          id,
          name
        },
        assets {
          id,
          descr
        }
    } excluding { office_floor, office_address_country, office_building, office_room, office_building_id, office_address_city, office_building_id, office_address_street, office_address_country_code, office_address_country_code, office_furniture_chairs,office_furniture_desks }`
    let expected = cds.ql`SELECT from Employee as Employee {
        Employee.id,
        Employee.name,
        Employee.job,
        Employee.department_id,
        (SELECT department.id, department.name from Department as department where Employee.department_id = department.id) as department,
        (SELECT assets.id, assets.descr from Assets as assets where Employee.id = assets.owner_id) as assets
    }`
    expect(
      JSON.parse(JSON.stringify(cqn4sql(expandQuery, cds.compile.for.nodejs(JSON.parse(JSON.stringify(model)))))),
    ).to.eql(expected)
  })

  it('multi expand with star but foreign key does not survive in structured mode', () => {
    let expandQuery = cds.ql`select from Employee {
        *,
        department {
          id,
          name
        },
        assets {
          id,
          descr
        }
    } excluding { office }`
    let expected = cds.ql`SELECT from Employee as Employee {
        Employee.id,
        Employee.name,
        Employee.job,
        (SELECT department.id, department.name from Department as department where Employee.department_id = department.id) as department,
        (SELECT assets.id, assets.descr from Assets as assets where Employee.id = assets.owner_id) as assets
    }`
    expect(JSON.parse(JSON.stringify(cqn4sql(expandQuery, model)))).to.eql(expected)
  })

  it('structured expand with deep assoc expand', () => {
    let expandQuery = cds.ql`select from Employee {
      office {
        floor,
        address {
          city,
          street,
          country {code}
        }
      }
    }`
    let expected = cds.ql`select from Employee as Employee {
      Employee.office_floor,
      Employee.office_address_city,
      Employee.office_address_street,
      (
        SELECT office_address_country.code from Country as office_address_country
        where Employee.office_address_country_code = office_address_country.code
      ) as office_address_country
    }`
    // expand subqueries have special non-enumerable props -> ignore them
    expect(JSON.parse(JSON.stringify(cqn4sql(expandQuery, model)))).to.eql(expected)
  })
  it('deep, structured expand', () => {
    let expandQuery = cds.ql`select from Employee {
      office {
        floor,
        address {
          city,
          street
        }
      }
    }`
    let expected = cds.ql`select from Employee as Employee{
      Employee.office_floor,
      Employee.office_address_city,
      Employee.office_address_street,
    }`
    expect(cqn4sql(expandQuery, model)).to.eql(expected)
  })
  it('deep expand on assoc within structure expand', () => {
    let expandQuery = cds.ql`select from Employee {
      office {
        floor,
        building {
          id
        }
      }
    }`
    let expected = cds.ql`select from Employee as Employee {
      Employee.office_floor,
      (
        select office_building.id from Building as office_building
        where Employee.office_building_id = office_building.id
      ) as office_building
    }`
    // expand subqueries have special non-enumerable props -> ignore them
    expect(JSON.parse(JSON.stringify(cqn4sql(expandQuery, model)))).to.eql(expected)
  })

  it('wildcard expand toplevel', () => {
    let expandQuery = cds.ql`select from EmployeeNoUnmanaged {
      office { * }
    }`
    let absolutePaths = cds.ql`select from EmployeeNoUnmanaged {
      office.floor,
      office.room,
      office.building,
      office.address,
      office.furniture
    }`

    let expected = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
      EmployeeNoUnmanaged.office_floor,
      EmployeeNoUnmanaged.office_room,
      EmployeeNoUnmanaged.office_building_id,
      EmployeeNoUnmanaged.office_address_city,
      EmployeeNoUnmanaged.office_address_street,
      EmployeeNoUnmanaged.office_address_country_code,
      EmployeeNoUnmanaged.office_furniture_chairs,
      EmployeeNoUnmanaged.office_furniture_desks
    }`
    let wildcard = cqn4sql(expandQuery)
    let absolute = cqn4sql(absolutePaths)
    expect(wildcard).to.eql(absolute).to.eql(expected)
  })
  it('wildcard on expand deep', () => {
    let expandQuery = cds.ql`select from EmployeeNoUnmanaged {
      office { address {*} }
    }`
    let expected = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
      EmployeeNoUnmanaged.office_address_city,
      EmployeeNoUnmanaged.office_address_street,
      EmployeeNoUnmanaged.office_address_country_code,
    }`

    expect(cqn4sql(expandQuery, model)).to.eql(expected)
  })

  it('smart wildcard - assoc overwrite after *', () => {
    // office.address.city replaces office.floor
    let expandQuery = cds.ql`select from EmployeeNoUnmanaged {
      office { *, furniture as building, address.city as floor, building.id as room }
    }`
    let expected = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
      EmployeeNoUnmanaged.office_address_city as office_floor,
      EmployeeNoUnmanaged.office_building_id as office_room,
      EmployeeNoUnmanaged.office_furniture_chairs as office_building_chairs,
      EmployeeNoUnmanaged.office_furniture_desks as office_building_desks,
      EmployeeNoUnmanaged.office_address_city,
      EmployeeNoUnmanaged.office_address_street,
      EmployeeNoUnmanaged.office_address_country_code,
      EmployeeNoUnmanaged.office_furniture_chairs,
      EmployeeNoUnmanaged.office_furniture_desks

    }`
    expect(cqn4sql(expandQuery, model)).to.eql(expected)
  })

  it('smart wildcard - structure overwritten by assoc before *', () => {
    // intermediate structures are overwritten
    let expandQuery = cds.ql`select from EmployeeNoUnmanaged {
      office.{ building as furniture, * }
    }`
    let expected = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
     EmployeeNoUnmanaged.office_building_id as office_furniture_id,
     EmployeeNoUnmanaged.office_floor,
     EmployeeNoUnmanaged.office_room,
     EmployeeNoUnmanaged.office_building_id,
     EmployeeNoUnmanaged.office_address_city,
     EmployeeNoUnmanaged.office_address_street,
     EmployeeNoUnmanaged.office_address_country_code
    }`
    expect(cqn4sql(expandQuery, model)).to.eql(expected)
  })
  it('smart wildcard - structure overwritten by join relevant assoc before *', () => {
    // intermediate structures are overwritten
    let expandQuery = cds.ql`select from EmployeeNoUnmanaged {
      office { building[name='mega tower'].name as furniture, * }
    }`
    let expected = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged
      left join Building as building on building.id = EmployeeNoUnmanaged.office_building_id and building.name = 'mega tower'
    {
     building.name as office_furniture,
     EmployeeNoUnmanaged.office_floor,
     EmployeeNoUnmanaged.office_room,
     EmployeeNoUnmanaged.office_building_id,
     EmployeeNoUnmanaged.office_address_city,
     EmployeeNoUnmanaged.office_address_street,
     EmployeeNoUnmanaged.office_address_country_code
    }`
    expect(cqn4sql(expandQuery, model)).to.eql(expected)
  })
  it('wildcard - no overwrite but additional cols', () => {
    // intermediate structures are overwritten
    let expandQuery = cds.ql`select from EmployeeNoUnmanaged {
      office { *, 'foo' as last }
    }`
    let expected = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged
    {
     EmployeeNoUnmanaged.office_floor,
     EmployeeNoUnmanaged.office_room,
     EmployeeNoUnmanaged.office_building_id,
     EmployeeNoUnmanaged.office_address_city,
     EmployeeNoUnmanaged.office_address_street,
     EmployeeNoUnmanaged.office_address_country_code,
     EmployeeNoUnmanaged.office_furniture_chairs,
     EmployeeNoUnmanaged.office_furniture_desks,
     'foo' as office_last
    }`
    expect(cqn4sql(expandQuery, model)).to.eql(expected)
  })
  it('assigning alias within expand only influences name of element, prefix still appended', () => {
    // intermediate structures are overwritten
    let expandQuery = cds.ql`select from EmployeeNoUnmanaged {
      office { floor as x }
    }`
    let expected = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
     EmployeeNoUnmanaged.office_floor as office_x,
    }`
    expect(cqn4sql(expandQuery, model)).to.eql(expected)
  })
  it('smart wildcard - structured overwrite before *', () => {
    // intermediate structures are overwritten
    let expandQuery = cds.ql`select from EmployeeNoUnmanaged {
      office { 'first' as furniture, 'second' as building, * }
    }`
    let expected = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
     'first' as office_furniture,
     'second' as office_building,
     EmployeeNoUnmanaged.office_floor,
     EmployeeNoUnmanaged.office_room,
     EmployeeNoUnmanaged.office_address_city,
     EmployeeNoUnmanaged.office_address_street,
     EmployeeNoUnmanaged.office_address_country_code,
    }`
    expect(cqn4sql(expandQuery, model)).to.eql(expected)
  })
  it('smart wildcard - structured overwrite after *', () => {
    // intermediate structures are overwritten
    let expandQuery = cds.ql`select from EmployeeNoUnmanaged {
      office {*, 'third' as building, 'fourth' as address }
    }`
    let expected = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
     EmployeeNoUnmanaged.office_floor,
     EmployeeNoUnmanaged.office_room,
     'third' as office_building,
     'fourth' as office_address,
     EmployeeNoUnmanaged.office_furniture_chairs,
     EmployeeNoUnmanaged.office_furniture_desks
    }`
    expect(cqn4sql(expandQuery, model)).to.eql(expected)
  })

  it('wildcard expansion - exclude association', () => {
    // intermediate structures are overwritten
    let expandQuery = cds.ql`select from EmployeeNoUnmanaged {
      office {*} excluding { building, address }
    }`
    let expected = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
     EmployeeNoUnmanaged.office_floor,
     EmployeeNoUnmanaged.office_room,
     EmployeeNoUnmanaged.office_furniture_chairs,
     EmployeeNoUnmanaged.office_furniture_desks
    }`
    expect(cqn4sql(expandQuery, model)).to.eql(expected)
  })

  it('wildcard expansion sql style on table alias', () => {
    let expandQuery = cds.ql`select from EmployeeNoUnmanaged as E {
      E {*}
    }`
    let regularWildcard = cds.ql`select from EmployeeNoUnmanaged as E {
      *
    }`
    let expected = cds.ql`select from EmployeeNoUnmanaged as E {
     E.id,
     E.name,
     E.job,
     E.department_id,
     E.office_floor,
     E.office_room,
     E.office_building_id,
     E.office_address_city,
     E.office_address_street,
     E.office_address_country_code,
     E.office_furniture_chairs,
     E.office_furniture_desks,
    }`
    expect(cqn4sql(expandQuery)).to.eql(cqn4sql(regularWildcard)).to.eql(expected)
  })
  it('wildcard expansion sql style on table alias - exclude stuff', () => {
    let expandQuery = cds.ql`select from EmployeeNoUnmanaged as E {
      E {*} excluding { office }
    }`
    let regularWildcard = cds.ql`select from EmployeeNoUnmanaged as E {
      *
    } excluding { office }`
    let expected = cds.ql`select from EmployeeNoUnmanaged as E {
     E.id,
     E.name,
     E.job,
     E.department_id

    }`
    expect(cqn4sql(expandQuery, model))
      .to.eql(expected)
      .to.eql(JSON.parse(JSON.stringify(cqn4sql(regularWildcard)))) // prototype is different
  })
  it('wildcard expansion sql style on IMPLICIT table alias - exclude stuff', () => {
    let expandQuery = cds.ql`select from EmployeeNoUnmanaged as E {
      {*} excluding { office } as FOO
    }`
    let expected = cds.ql`select from EmployeeNoUnmanaged as E {
     E.FOO_id,
     E.FOO_name,
     E.FOO_job,
     E.FOO_department_id

    }`
    expect(cqn4sql(expandQuery, model)).to.eql(expected)
  })
})
