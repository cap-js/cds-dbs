import cqn4sql from '../../lib/cqn4sql.js'
import cds from '@sap/cds'
const { expect } = cds.test
const transitive_ = !cds.unfold || 'transitive_localized_views' in cds.env.sql && cds.env.sql.transitive_localized_views !== false
const options = { fewerLocalizedViews: false }

describe('localized', () => {
  let model
  beforeAll(async () => {
    model = await cds.load(__dirname + '/../bookshop/db/schema').then( m => cds.compile.for.nodejs(m, options))
  })
  it('performs no replacement if not requested', () => {
    const q = cds.ql`SELECT from bookshop.Books as Books {ID, title}`
    let query = cqn4sql(q, model)
    expect(cds.clone(query)).to.deep.equal(cds.ql`
        SELECT from bookshop.Books as Books
                    {
                      Books.ID,
                      Books.title,
                    }`)
  })
  it('performs simple replacement of ref', () => {
    const q = SELECT.localized `from bookshop.Books as Books {ID, title}`
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
        SELECT from ${transitive_ ? 'localized.' : ''}bookshop.Authors as $A
            {
              $A.ID,
            } where exists (
              SELECT 1 from localized.bookshop.Books as $b where $b.author_ID = $A.ID and $b.title = 'Sturmhöhe'
            )`))
  })
  it('uses localized table in where exists subquery (2)', () => {
    const q = SELECT.localized `from bookshop.Authors:books[title = 'Sturmhöhe'] {ID}`
    let query = cqn4sql(q, model)
    expect(cds.clone(query)).to.deep.equal(CQL(`
        SELECT from localized.bookshop.Books as $b
            {
              $b.ID,
            } where exists (
              SELECT 1 from ${transitive_ ? 'localized.' : ''}bookshop.Authors as $A where $A.ID = $b.author_ID
            ) and $b.title = 'Sturmhöhe'`))
  })
  it('performs no replacement of ref if ”@cds.localized: false”', () => {
    const q = SELECT.localized `from bookshop.BP as BP {ID, title}`
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
        SELECT from bookshop.BP as $B
                    {
                      $B.ID,
                      $B.title,
                      (
                        SELECT $c.code from sap.common.Currencies as $c
                          where $B.currency_code = $c.code
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
      SELECT from ${transitive_?'localized.':''}bookshop.DataRestrictions as $D {
        $D.ID,
        (
          SELECT from ${transitive_?'localized.':''}bookshop.DataRestrictionAccessGroups as $d2 {
            $d2.dataRestrictionID,
            $d2.accessGroupID,
            (
              SELECT from localized.bookshop.AccessGroups as $a {
                $a.ID
              } where $a.ID = $d2.accessGroupID
            ) as accessGroup
          } where $D.ID = $d2.dataRestrictionID
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
        SELECT from localized.bookshop.BPLocalized as $B
                    {
                      $B.ID,
                      $B.title,
                    }`)
  })
  it('performs simple replacement of ref within subquery', () => {
    const q = SELECT.localized `from bookshop.Books {ID, title, (SELECT title from bookshop.Books) as foo}`
    let query = cqn4sql(q, model)
    expect(cds.clone(query)).to.deep.equal(cds.ql`
        SELECT from localized.bookshop.Books as $B
                    {
                      $B.ID,
                      $B.title,
                      (SELECT $B2.title from localized.bookshop.Books as $B2) as foo
                    }`)
  })
  it('performs simple replacement of ref within subquery in from', () => {
    const q = SELECT.localized `from (SELECT Books.title from bookshop.Books as Books) as foo { foo.title }`
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
    const q = SELECT.localized `from bookshop.BP as BP {ID, title, (SELECT title from bookshop.Books as Books) as foo}`
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
    const q = SELECT.localized `from bookshop.Books as Books {ID, title, author.name as author}`
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
        SELECT from localized.bookshop.Books as $B
                left outer join ${transitive_ ? 'localized.' : ''}bookshop.Authors as author on author.ID = $B.author_ID
                left outer join localized.bookshop.Books as books on books.author_ID = author.ID
                    {
                      $B.ID,
                      books.title as author_books_title,
                      author.name as author
                    }`))
  })

  it('replaces target in special expand subquery with localized equivalent', () => {
    const q = SELECT.localized `from bookshop.Books {
        author as books { name }
      }`
    const qx = CQL(`SELECT from localized.bookshop.Books as $B {
        (SELECT $b2.name from ${transitive_ ? 'localized.' : ''}bookshop.Authors as $b2 where $B.author_ID = $b2.ID) as books
      }`)
    const res = cqn4sql(q, model)
    expect(cds.clone(res)).to.deep.equal(qx)
  })
  // TODO dont shadow query alias
  it('replaces target in subquery within expand subquery', () => {
    const q = SELECT.localized`from bookshop.Books {
        author as books { name, (SELECT title from bookshop.Books) as foo }
      }`
    const qx = CQL(`SELECT from localized.bookshop.Books as $B {
        (SELECT $b2.name, (SELECT $B3.title from localized.bookshop.Books as $B3) as foo from ${transitive_ ? 'localized.' : ''}bookshop.Authors as $b2 where $B.author_ID = $b2.ID) as books
      }`)
    const res = cqn4sql(q, model)
    expect(cds.clone(res)).to.deep.equal(qx)
  })

  it('unmanaged, localized path expression', () => {
    const q = SELECT.localized`from bookshop.AuthorsUnmanagedBooks:books {
      ID
    }`
    const qx = CQL(`SELECT from localized.bookshop.Books as $b {
      $b.ID
    } where exists (
      SELECT 1 from ${transitive_ ? 'localized.' : ''}bookshop.AuthorsUnmanagedBooks as $A where $b.coAuthor_ID_unmanaged = $A.ID
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
      SELECT from localized.Boo as $b { $b.ID } WHERE EXISTS (
        SELECT 1 from localized.Foo as $F3 WHERE $F3.ID = $b.foo_ID
      ) AND (
        EXISTS (
          SELECT 1 from localized.Foo as $f WHERE $f.ID = $b.foo_ID AND EXISTS (
            SELECT 1 from ${transitive_?'localized.':''}SpecialOwner2 as $s
            WHERE $s.foo_ID = $f.ID and $s.owner2_userID = $user.id
          )
        )
        OR
        EXISTS (
          SELECT 1 from localized.Foo as $f2 WHERE $f2.ID = $b.foo_ID AND EXISTS (
            SELECT 1 from ${transitive_?'localized.':''}ActiveOwner as $a
            WHERE $a.foo_ID = $f2.ID and $a.owner_userID = $user.id
          )
        )
      )
    `))
  })
  it('can handle redirections', () => {
    const q = SELECT.localized `from bookshop.Third[ID = 4711]:first { BUBU }`
    let query = cqn4sql(q, model)
    const expected = cds.ql`
      SELECT from localized.bookshop.FirstRedirected as $f { $f.BUBU }
      where exists (
        SELECT 1 from localized.bookshop.Third as $T where $T.ID = $f.BUBU and $T.ID = 4711
      )`
    expect(JSON.parse(JSON.stringify(expected))).to.eql(JSON.parse(JSON.stringify(query)))
  })
})
