'use strict'

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds/lib')
const localized_ = cds.unfold ? '' : 'localized.'
const { expect } = cds.test

describe('localized', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
    model = cds.compile.for.nodejs(model)
  })
  it('performs no replacement if not requested', () => {
    const q = CQL`SELECT from bookshop.Books {ID, title}`
    let query = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(CQL`
        SELECT from bookshop.Books as Books
                    {
                      Books.ID,
                      Books.title,
                    }`)
  })
  it('performs simple replacement of ref', () => {
    const q = CQL`SELECT from bookshop.Books {ID, title}`
    q.SELECT.localized = true
    let query = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(CQL`
        SELECT from localized.bookshop.Books as Books
                    {
                      Books.ID,
                      Books.title,
                    }`)
  })
  it('uses localized table in where exists subquery', () => {
    const q = CQL`SELECT from bookshop.Authors {ID} where exists books[title = 'Sturmhöhe']`
    q.SELECT.localized = true
    let query = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(CQL(`
        SELECT from ${localized_}bookshop.Authors as Authors
            {
              Authors.ID,
            } where exists (
              SELECT 1 from localized.bookshop.Books as books where books.author_ID = Authors.ID and books.title = 'Sturmhöhe'
            )`))
  })
  it('uses localized table in where exists subquery (2)', () => {
    const q = CQL`SELECT from bookshop.Authors:books[title = 'Sturmhöhe'] {ID}`
    q.SELECT.localized = true
    let query = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(CQL(`
        SELECT from localized.bookshop.Books as books
            {
              books.ID,
            } where exists (
              SELECT 1 from ${localized_}bookshop.Authors as Authors where Authors.ID = books.author_ID
            ) and books.title = 'Sturmhöhe'`))
  })
  it('performs no replacement of ref if ”@cds.localized: false”', () => {
    const q = CQL`SELECT from bookshop.BP {ID, title}`
    q.SELECT.localized = true
    let query = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(CQL`
        SELECT from bookshop.BP as BP
                    {
                      BP.ID,
                      BP.title,
                    }`)
  })
  it('performs no replacement of ref if ”@cds.localized: false” and does not yield localized results for expand', () => {
    const q = CQL`SELECT from bookshop.BP {ID, title, currency { code } }`
    q.SELECT.localized = true
    let query = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(CQL`
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
    const q = CQL`SELECT from bookshop.BPLocalized {ID, title}`
    q.SELECT.localized = true
    let query = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(CQL`
        SELECT from localized.bookshop.BPLocalized as BPLocalized
                    {
                      BPLocalized.ID,
                      BPLocalized.title,
                    }`)
  })
  it('performs simple replacement of ref within subquery', () => {
    const q = CQL`SELECT from bookshop.Books {ID, title, (SELECT title from bookshop.Books) as foo}`
    q.SELECT.localized = true
    let query = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(CQL`
        SELECT from localized.bookshop.Books as Books
                    {
                      Books.ID,
                      Books.title,
                      (SELECT Books2.title from localized.bookshop.Books as Books2) as foo
                    }`)
  })
  it('performs simple replacement of ref within subquery in from', () => {
    const q = CQL`SELECT from (SELECT Books.title from bookshop.Books) as foo { foo.title }`
    q.SELECT.localized = true
    let query = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(CQL`
        SELECT from (
            SELECT Books.title from localized.bookshop.Books as Books
          ) as foo
        {
          foo.title,
        }`
    )
  })
  it('performs no replacement of ref within subquery if main query has ”@cds.localized: false”', () => {
    const q = CQL`SELECT from bookshop.BP {ID, title, (SELECT title from bookshop.Books) as foo}`
    q.SELECT.localized = true
    let query = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(CQL`
        SELECT from bookshop.BP as BP
                    {
                      BP.ID,
                      BP.title,
                      (SELECT Books.title from bookshop.Books as Books) as foo
                    }`)
  })

  it('replaces ref in from with localized within join', () => {
    const q = CQL`SELECT from bookshop.Books {ID, title, author.name as author}`
    // request localized target replacement
    q.SELECT.localized = true
    let query = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(CQL(`
        SELECT from localized.bookshop.Books as Books left outer join
                    ${localized_}bookshop.Authors as author
                    on  author.ID = Books.author_ID
                    {
                      Books.ID,
                      Books.title,
                      author.name as author
                    }`))
  })

  it('replaces ref in from with localized within join (2)', () => {
    const q = CQL`SELECT from bookshop.Books {ID, author.books.title, author.name as author}`
    // request localized target replacement
    q.SELECT.localized = true
    let query = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(CQL(`
        SELECT from localized.bookshop.Books as Books
                left outer join ${localized_}bookshop.Authors as author on author.ID = Books.author_ID
                left outer join localized.bookshop.Books as books2 on books2.author_ID = author.ID
                    {
                      Books.ID,
                      books2.title as author_books_title,
                      author.name as author
                    }`))
  })

  it('replaces target in special expand subquery with localized equivalent', () => {
    const q = CQL`SELECT from bookshop.Books {
        author as books { name }
      }`
    q.SELECT.localized = true
    const qx = CQL(`SELECT from localized.bookshop.Books as Books {
        (SELECT books2.name from ${localized_}bookshop.Authors as books2 where Books.author_ID = books2.ID) as books
      }`)
    const res = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })
  // TODO dont shadow query alias
  it('replaces target in subquery within expand subquery', () => {
    const q = CQL`SELECT from bookshop.Books {
        author as books { name, (SELECT title from bookshop.Books) as foo }
      }`
    q.SELECT.localized = true
    const qx = CQL(`SELECT from localized.bookshop.Books as Books {
        (SELECT books2.name, (SELECT Books3.title from localized.bookshop.Books as Books3) as foo from ${localized_}bookshop.Authors as books2 where Books.author_ID = books2.ID) as books
      }`)
    const res = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })

  it('unmanaged, localized path expression', () => {
    const q = CQL`SELECT from bookshop.AuthorsUnmanagedBooks:books {
      ID
    }`
    q.SELECT.localized = true
    const qx = CQL(`SELECT from localized.bookshop.Books as books {
      books.ID
    } where exists (
      SELECT 1 from ${localized_}bookshop.AuthorsUnmanagedBooks as AuthorsUnmanagedBooks where books.coAuthor_ID_unmanaged = AuthorsUnmanagedBooks.ID
    )`)
    const res = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })
})
