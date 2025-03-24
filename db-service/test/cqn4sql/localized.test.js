// process.env.CDS_ENV = 'better-sqlite'
'use strict'

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds')
const { expect } = cds.test
const transitive_ = !cds.unfold || 'transitive_localized_views' in cds.env.sql && cds.env.sql.transitive_localized_views !== false
const options = { fewerLocalizedViews: false }

describe('localized', () => {
  let model
  beforeAll(async () => {
    model = await cds.load(__dirname + '/../bookshop/db/schema').then( m => cds.compile.for.nodejs(m, options))
  })
  it('performs no replacement if not requested', () => {
    const q = cds.ql`SELECT from bookshop.Books {ID, title}`
    let query = cqn4sql(q, model)
    expect(cds.clone(query)).to.deep.equal(cds.ql`
        SELECT from bookshop.Books as Books
                    {
                      Books.ID,
                      Books.title,
                    }`)
  })
  it('performs simple replacement of ref', () => {
    const q = SELECT.localized `from bookshop.Books {ID, title}`
    let query = cqn4sql(q, model)
    expect(cds.clone(query)).to.deep.equal(cds.ql`
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
    expect(cds.clone(query)).to.deep.equal(cds.ql`
        SELECT from bookshop.BP as BP
                    {
                      BP.ID,
                      BP.title,
                    }`)
  })
  it('performs no replacement of ref if ”@cds.localized: false” and does not yield localized results for expand', () => {
    const q = SELECT.localized `from bookshop.BP {ID, title, currency { code } }`
    let query = cqn4sql(q, model)
    expect(cds.clone(query)).to.deep.equal(cds.ql`
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

  it('nested expand with unmanaged backlink', () => {
    let expandQuery = SELECT.localized `from bookshop.DataRestrictions {
      *,
      dataRestrictionAccessGroups {
        dataRestrictionID,
        accessGroupID,
        accessGroup {
          ID
        }
      }
    }`
    let expected = CQL(`
      SELECT from ${transitive_?'localized.':''}bookshop.DataRestrictions as DataRestrictions {
        DataRestrictions.ID,
        (
          SELECT from ${transitive_?'localized.':''}bookshop.DataRestrictionAccessGroups as dataRestrictionAccessGroups {
            dataRestrictionAccessGroups.dataRestrictionID,
            dataRestrictionAccessGroups.accessGroupID,
            (
              SELECT from localized.bookshop.AccessGroups as accessGroup {
                accessGroup.ID
              } where accessGroup.ID = dataRestrictionAccessGroups.accessGroupID
            ) as accessGroup
          } where DataRestrictions.ID = dataRestrictionAccessGroups.dataRestrictionID
        ) as dataRestrictionAccessGroups
      }
    `)
    // seems to only happen with the `for.nodejs(…)` compiled model
    expect(cds.clone(cqn4sql(expandQuery, cds.compile.for.nodejs(JSON.parse(JSON.stringify(model)))))).to.deep.equal(expected)
  })

  it('performs replacement of ref if ”@cds.localized: true” and localized is set', () => {
    const q = SELECT.localized `from bookshop.BPLocalized {ID, title}`
    let query = cqn4sql(q, model)
    expect(cds.clone(query)).to.deep.equal(cds.ql`
        SELECT from localized.bookshop.BPLocalized as BPLocalized
                    {
                      BPLocalized.ID,
                      BPLocalized.title,
                    }`)
  })
  it('performs simple replacement of ref within subquery', () => {
    const q = SELECT.localized `from bookshop.Books {ID, title, (SELECT title from bookshop.Books) as foo}`
    let query = cqn4sql(q, model)
    expect(cds.clone(query)).to.deep.equal(cds.ql`
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
    expect(cds.clone(query)).to.deep.equal(cds.ql`
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
    expect(cds.clone(query)).to.deep.equal(cds.ql`
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

  it('should handle localized associations in on-conditions properly', async () => {
    let stakeholderModel = cds.model = await cds.load(__dirname + '/model/cap_issue').then(cds.linked)
    stakeholderModel = cds.compile.for.nodejs(JSON.parse(JSON.stringify(stakeholderModel)), options)
    // make sure that in a localized scenario, all aliases
    // are properly replaced in the on-conditions.

    // the issue here was that we had a where condition like
    // `where exists foo[id=1] or exists foo[id=2]`
    // with `foo` being an association `foo : Association to one Foo on foo.ID = foo_ID;`.
    // While building up the where exists subqueries, we calculate unique table aliases for `foo`,
    // which results in a table alias `foo2` for the second condition of the initial where clause.
    // Now, if we incorporate the on-condition into the where clause of the second where exists subquery,
    // we must replace the table alias `foo` from the on-condition with `foo2`.

    // the described scenario didn't work because in a localized scenario, the localized `foo`
    // association (pointing to `localized.Foo`) was compared to the non-localized version
    // of the association (pointing to `Foo`) and hence, the alias was not properly replaced
    let q = SELECT.localized `from Foo:boos { ID }
      where exists foo.specialOwners[owner2_userID = $user.id]
      or exists foo.activeOwners[owner_userID = $user.id]
    `
    let q2 = cqn4sql(q, stakeholderModel)
    expect(cds.clone(q2)).to.deep.equal(CQL(`
      SELECT from localized.Boo as boos { boos.ID } WHERE EXISTS (
        SELECT 1 from localized.Foo as Foo3 WHERE Foo3.ID = boos.foo_ID
      ) AND (
        EXISTS (
          SELECT 1 from localized.Foo as foo WHERE foo.ID = boos.foo_ID AND EXISTS (
            SELECT 1 from ${transitive_?'localized.':''}SpecialOwner2 as specialOwners
            WHERE specialOwners.foo_ID = foo.ID and specialOwners.owner2_userID = $user.id
          )
        )
        OR
        EXISTS (
          SELECT 1 from localized.Foo as foo2 WHERE foo2.ID = boos.foo_ID AND EXISTS (
            SELECT 1 from ${transitive_?'localized.':''}ActiveOwner as activeOwners
            WHERE activeOwners.foo_ID = foo2.ID and activeOwners.owner_userID = $user.id
          )
        )
      )
    `))
  })
})
