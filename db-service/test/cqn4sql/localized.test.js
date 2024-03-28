// process.env.CDS_ENV = 'better-sqlite'
'use strict'

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds/lib')
const { expect } = cds.test
const transitive_ = !cds.unfold || 'transitive_localized_views' in cds.env.sql && cds.env.sql.transitive_localized_views !== false

describe('localized', () => {
  let model
  beforeAll(async () => {
    model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.compile.for.nodejs)
  })
  it('performs no replacement if not requested', () => {
    const q = CQL`SELECT from bookshop.Books {ID, title}`
    let query = cqn4sql(q, model)
    expect(cds.clone(query)).to.deep.equal(CQL`
        SELECT from bookshop.Books as Books
                    {
                      Books.ID,
                      Books.title,
                    }`)
  })
  it('performs simple replacement of ref', () => {
    const q = SELECT.localized `from bookshop.Books {ID, title}`
    let query = cqn4sql(q, model)
    expect(cds.clone(query)).to.deep.equal(CQL`
        SELECT from localized.bookshop.Books as Books
                    {
                      Books.ID,
                      Books.title,
                    }`)
  })
  it('uses localized table in where exists subquery', () => {
    const q = SELECT.localized `from bookshop.Authors {ID} where exists books[title = 'Sturmhöhe']`
    let query = cqn4sql(q, model)
    expect(cds.clone(query)).to.deep.equal(CQL(`
        SELECT from ${transitive_ ? 'localized.' : ''}bookshop.Authors as Authors
            {
              Authors.ID,
            } where exists (
              SELECT 1 from localized.bookshop.Books as books where books.author_ID = Authors.ID and books.title = 'Sturmhöhe'
            )`))
  })
  it('uses localized table in where exists subquery (2)', () => {
    const q = SELECT.localized `from bookshop.Authors:books[title = 'Sturmhöhe'] {ID}`
    let query = cqn4sql(q, model)
    expect(cds.clone(query)).to.deep.equal(CQL(`
        SELECT from localized.bookshop.Books as books
            {
              books.ID,
            } where exists (
              SELECT 1 from ${transitive_ ? 'localized.' : ''}bookshop.Authors as Authors where Authors.ID = books.author_ID
            ) and books.title = 'Sturmhöhe'`))
  })
  it('performs no replacement of ref if ”@cds.localized: false”', () => {
    const q = SELECT.localized `from bookshop.BP {ID, title}`
    let query = cqn4sql(q, model)
    expect(cds.clone(query)).to.deep.equal(CQL`
        SELECT from bookshop.BP as BP
                    {
                      BP.ID,
                      BP.title,
                    }`)
  })
  it('performs no replacement of ref if ”@cds.localized: false” and does not yield localized results for expand', () => {
    const q = SELECT.localized `from bookshop.BP {ID, title, currency { code } }`
    let query = cqn4sql(q, model)
    expect(cds.clone(query)).to.deep.equal(CQL`
        SELECT from bookshop.BP as BP
                    {
                      BP.ID,
                      BP.title,
                      (
                        SELECT currency.code from sap.common.Currencies as currency
                          where BP.currency_code = currency.code
                      ) as currency
                    }`)
  })
  it('performs replacement of ref if ”@cds.localized: true” and localized is set', () => {
    const q = SELECT.localized `from bookshop.BPLocalized {ID, title}`
    let query = cqn4sql(q, model)
    expect(cds.clone(query)).to.deep.equal(CQL`
        SELECT from localized.bookshop.BPLocalized as BPLocalized
                    {
                      BPLocalized.ID,
                      BPLocalized.title,
                    }`)
  })
  it('performs simple replacement of ref within subquery', () => {
    const q = SELECT.localized `from bookshop.Books {ID, title, (SELECT title from bookshop.Books) as foo}`
    let query = cqn4sql(q, model)
    expect(cds.clone(query)).to.deep.equal(CQL`
        SELECT from localized.bookshop.Books as Books
                    {
                      Books.ID,
                      Books.title,
                      (SELECT Books2.title from localized.bookshop.Books as Books2) as foo
                    }`)
  })
  it('performs simple replacement of ref within subquery in from', () => {
    const q = SELECT.localized `from (SELECT Books.title from bookshop.Books) as foo { foo.title }`
    let query = cqn4sql(q, model)
    expect(cds.clone(query)).to.deep.equal(CQL`
        SELECT from (
            SELECT Books.title from localized.bookshop.Books as Books
          ) as foo
        {
          foo.title,
        }`
    )
  })
  it('performs no replacement of ref within subquery if main query has ”@cds.localized: false”', () => {
    const q = SELECT.localized `from bookshop.BP {ID, title, (SELECT title from bookshop.Books) as foo}`
    let query = cqn4sql(q, model)
    expect(cds.clone(query)).to.deep.equal(CQL`
        SELECT from bookshop.BP as BP
                    {
                      BP.ID,
                      BP.title,
                      (SELECT Books.title from bookshop.Books as Books) as foo
                    }`)
  })

  it('replaces ref in from with localized within join', () => {
    const q = SELECT.localized `from bookshop.Books {ID, title, author.name as author}`
    // request localized target replacement
    let query = cqn4sql(q, model)
    expect(cds.clone(query)).to.deep.equal(CQL(`
        SELECT from localized.bookshop.Books as Books left outer join
                    ${transitive_ ? 'localized.' : ''}bookshop.Authors as author
                    on  author.ID = Books.author_ID
                    {
                      Books.ID,
                      Books.title,
                      author.name as author
                    }`))
  })

  it('replaces ref in from with localized within join (2)', () => {
    const q = SELECT.localized `from bookshop.Books {ID, author.books.title, author.name as author}`
    // request localized target replacement
    let query = cqn4sql(q, model)
    expect(cds.clone(query)).to.deep.equal(CQL(`
        SELECT from localized.bookshop.Books as Books
                left outer join ${transitive_ ? 'localized.' : ''}bookshop.Authors as author on author.ID = Books.author_ID
                left outer join localized.bookshop.Books as books2 on books2.author_ID = author.ID
                    {
                      Books.ID,
                      books2.title as author_books_title,
                      author.name as author
                    }`))
  })

  it('replaces target in special expand subquery with localized equivalent', () => {
    const q = SELECT.localized `from bookshop.Books {
        author as books { name }
      }`
    const qx = CQL(`SELECT from localized.bookshop.Books as Books {
        (SELECT books2.name from ${transitive_ ? 'localized.' : ''}bookshop.Authors as books2 where Books.author_ID = books2.ID) as books
      }`)
    const res = cqn4sql(q, model)
    expect(cds.clone(res)).to.deep.equal(qx)
  })
  // TODO dont shadow query alias
  it('replaces target in subquery within expand subquery', () => {
    const q = SELECT.localized`from bookshop.Books {
        author as books { name, (SELECT title from bookshop.Books) as foo }
      }`
    const qx = CQL(`SELECT from localized.bookshop.Books as Books {
        (SELECT books2.name, (SELECT Books3.title from localized.bookshop.Books as Books3) as foo from ${transitive_ ? 'localized.' : ''}bookshop.Authors as books2 where Books.author_ID = books2.ID) as books
      }`)
    const res = cqn4sql(q, model)
    expect(cds.clone(res)).to.deep.equal(qx)
  })

  it('unmanaged, localized path expression', () => {
    const q = SELECT.localized`from bookshop.AuthorsUnmanagedBooks:books {
      ID
    }`
    const qx = CQL(`SELECT from localized.bookshop.Books as books {
      books.ID
    } where exists (
      SELECT 1 from ${transitive_ ? 'localized.' : ''}bookshop.AuthorsUnmanagedBooks as AuthorsUnmanagedBooks where books.coAuthor_ID_unmanaged = AuthorsUnmanagedBooks.ID
    )`)
    const res = cqn4sql(q, model)
    expect(cds.clone(res)).to.deep.equal(qx)
  })
})
