const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

describe('Runtime Views', () => {
  const { expect } = cds.test(bookshop)

  beforeAll(async () => {
    const { Edition, Page, Review } = cds.entities('bookshop')
    const inserts = [
      INSERT.into(Page).entries([
        { ID: 1, text: 'first page', author_ID: 101, book_ID: 201 },
        { ID: 2, text: 'second page', author_ID: 107, book_ID: 201 },
        { ID: 3, text: 'third page', author_ID: 101, book_ID: 201 },
        { ID: 4, text: 'fourth page', author_ID: 170, book_ID: 201 },
        { ID: 5, text: 'first page', author_ID: 107, book_ID: 207 }
      ]),
      INSERT.into(Review).entries([
        { ID: 1, text: 'bad', page_ID: 1, author_ID: 170 },
        { ID: 2, text: 'good', page_ID: 2, author_ID: 150 },
        { ID: 3, text: 'very bad', page_ID: 3, author_ID: 107 },
        { ID: 4, text: 'horrible', page_ID: 4, author_ID: 101 },
        { ID: 5, text: 'okay', page_ID: 5, author_ID: 107  },
        { ID: 6, text: 'not that bad', page_ID: 1, author_ID: 101 },
      ]),
      INSERT.into(Edition).entries([ { ID: 201 }, { ID: 207 }, { ID: 251}, { ID: 280 }, { ID: 271 } ])
    ]
    await cds.run(inserts)
    cds.env.features.runtime_views = true
  })

  afterAll(() => {
    cds.env.features.runtime_views = false
  })

  describe('Runtime View Operations', () => {
    describe('Depth 1 - runtimeViews0', () => {
      test('basic runtimeViews0.Book', async () => {
        const { Book: RTView } = cds.entities('runtimeViews0Service')
        const { Book: DBView } = cds.entities('views0Service')
        const res = await SELECT.one.from(RTView).where({ ID: 201 })
        expect(res).to.deep.include({
          ID: 201,
          title: 'Wuthering Heights',
        })
        const resDeployed = await SELECT.one.from(DBView).where({ ID: 201 })
        expect(res).to.deep.equal(resDeployed)
      })

      test('runtimeViews0.Book with nested expand', async () => {
        const { Book: RTView } = cds.entities('runtimeViews0Service')
        const { Book: DBView } = cds.entities('views0Service')
        const columns = [
          'ID',
          { ref: ['pages'], expand: [{ ref: ['ID'] }] },
          { ref: ['author'], expand: [{ ref: ['name'] },
            { ref: ['reviews'], expand: [{ ref: ['ID'] }, { ref: ['text'] }] }] 
          }]
        const res = await SELECT.one.from(RTView)
        .columns(columns)
        .where({ ID: 201 })
        expect(res).to.deep.include({
          ID: 201,
          author: {
            name: "Emily Brontë",
            reviews: [{ ID: 4, text: 'horrible' }, { ID: 6, text: 'not that bad' }]
          },
          pages: [{ ID: 1 }, { ID: 2 }, { ID: 3 }, { ID: 4 }]
        })
        const resDeployed = await SELECT.one.from(DBView).columns(columns).where({ ID: 201 })
        expect(res).to.deep.equal(resDeployed)
      })

      test('runtimeViews0.Book with nested expand to the same entity - Page', async () => {
        const { Book: RTView } = cds.entities('runtimeViews0Service')
        const { Book: DBView } = cds.entities('views0Service')
        const columns = [
          'ID',
          { ref: ['pages'], expand: [{ ref: ['ID'] }] },
          { ref: ['author'], expand: [{ ref: ['name'] },
            { ref: ['reviews'], expand: [{ ref: ['ID'] }, { ref: ['text'] },
              { ref: ['page'], expand: [{ ref: ['ID'] }] }]
            }]
          }
        ]
        const res = await SELECT.one.from(RTView)
        .columns(columns)
        .where({ ID: 201 })
        expect(res).to.deep.include({
          ID: 201,
          author: {
            name: "Emily Brontë",
            reviews: [{ ID: 4, text: 'horrible', page: { ID: 4 } }, { ID: 6, text: 'not that bad', page: { ID: 1 } }]
          },
          pages: [{ ID: 1 }, { ID: 2 }, { ID: 3 }, { ID: 4 }]
        })
        const resDeployed = await SELECT.one.from(DBView).columns(columns).where({ ID: 201 })
        expect(res).to.deep.equal(resDeployed)
      })

      test('runtimeViews0.Book with nested expand by the same navigation - pages', async () => {
        const { Book: RTView } = cds.entities('runtimeViews0Service')
        const { Book: DBView } = cds.entities('views0Service')
        const res = await SELECT.one.from(RTView)
        .columns([
          'ID',
          { ref: ['pages'], expand: [{ ref: ['ID'] }] },
          { ref: ['author'], expand: [{ ref: ['name'] },
            { ref: ['pages'], expand: [{ ref: ['ID'] }] }]
          }])
        .where({ ID: 201 })
        expect(res).to.deep.include({
          ID: 201,
          author: {
            name: "Emily Brontë",
            pages: [{ ID: 1 }, { ID: 3 }]
          },
          pages: [{ ID: 1 }, { ID: 2 }, { ID: 3 }, { ID: 4 }]
        })
        const resDeployed = await SELECT.one.from(DBView).columns(['ID', { expand: [{ ref: ['ID'] }], ref: ['pages'] }, { expand: [{ ref: ['name'] }, { expand: [{ ref: ['ID'] }], ref: ['pages'] }], ref: ['author'] }]).where({ ID: 201 })
        expect(res).to.deep.equal(resDeployed)
      })

      test('runtimeViews0.Book with recursive expand - BooksView', async () => {
        const { Book: RTView } = cds.entities('runtimeViews0Service')
        const { Book: DBView } = cds.entities('views0Service')
        const columns = [
          'ID',
          'title',
          // normal
          { ref: ['author'], expand: [{ ref: ['name'] },
            { ref: ['pages'], expand: [{ ref: ['ID'] }] }]
          },
          // recursive
          { ref: ['this'], expand: [{ ref: ['title'] },
            { ref: ['pages'], expand: [{ ref: ['ID'] }] }]
          }]
        const res = await SELECT.one.from(RTView)
        .columns(columns)
        .where({ ID: 201 })
        expect(res).to.deep.include({
          ID: 201,
          author: {
            name: "Emily Brontë",
            pages: [{ ID: 1 }, { ID: 3 }]
          },
          this: { pages: [{ ID: 1 }, { ID: 2 }, { ID: 3 }, { ID: 4 }], title: 'Wuthering Heights' },
          title: 'Wuthering Heights'
        })
        const resDeployed = await SELECT.one.from(DBView).columns(columns).where({ ID: 201 })
        expect(res).to.deep.equal(resDeployed)
      })

      test('runtimeViews0.Book with where', async () => {
        const { Book: RTView } = cds.entities('runtimeViews0Service')
        const { Book: DBView } = cds.entities('views0Service')
        const res = await SELECT.from(RTView)
          .columns([{ ref: ['author'], expand: ['*'] }])
          .where('ID != 201')
          .orderBy('title')

        const authors = res.map(b => b.author.name)
        expect(authors).to.deep.equal(['Richard Carpenter', 'Edgar Allen Poe', 'Charlotte Brontë', 'Edgar Allen Poe', "Emily Brontë"])

        const resDeployed = await SELECT.from(DBView)
          .columns([{ ref: ['author'], expand: ['*'] }])
          .where('ID != 201')
          .orderBy('title')
        expect(res).to.deep.equal(resDeployed)
      })
    })

    describe('Depth > 1', () => {
      
      test('depth 2 - basic runtimeViews1.Book', async () => {
        const { Book: RTView } = cds.entities('runtimeViews1Service')
        const { Book: DBView } = cds.entities('views1Service')
        const res = await SELECT.one.from(RTView).where({ id: 201 })
        expect(res).to.include({
          id: 201,
          title: 'Wuthering Heights',
          authorName: 'Emily Brontë',
          author_dateOfBirth: '1818-07-30',
          author_placeOfBirth: 'Thornton, Yorkshire',
          type: 'Book',
        })
        const resDeployed = await SELECT.one.from(DBView).where({ id: 201 })
        expect(res).to.deep.equal(resDeployed)
      })
      
      test('depth 3 - basic runtimeViews2.Book', async () => {
        const { Book: RTView } = cds.entities('runtimeViews2Service')
        const { Book: DBView } = cds.entities('views2Service')
        const res = await SELECT.one.from(RTView).columns(['id']).where({ id: 201 })
        expect(res).to.deep.include({
          id: 201,
        })

        const resDeployed = await SELECT.one.from(DBView).columns(['id']).where({ id: 201 })
        expect(res).to.deep.equal(resDeployed)
      })

      test('depth 3 with inline navigation - Authorid', async () => {
        const { Book: RTView } = cds.entities('runtimeViews2Service')
        const { Book: DBView } = cds.entities('views2Service')
        const res = await SELECT.one.from(RTView).columns(['id', 'Authorid']).where({ id: 201 })

        expect(res).to.deep.include({
          id: 201,
          Authorid: 101,
        })

        const resDeployed = await SELECT.one.from(DBView).columns(['id', 'Authorid']).where({ id: 201 })
        expect(res).to.deep.equal(resDeployed)
      })

      test('depth 3 with subselect and field aliasing', async () => {
        const { Book: RTView0 } = cds.entities('runtimeViews0Service')
        const { Book: RTView2 } = cds.entities('runtimeViews2Service')
        const { Book: DBView0 } = cds.entities('views0Service')
        const { Book: DBView2 } = cds.entities('views2Service')

        const res = await cds.ql`
          SELECT id as bookId, AuthorName as writer, 'runtime2' as source
          FROM ${RTView2}
          WHERE id IN (
            SELECT ID
            FROM ${RTView0}
            WHERE ID = ${201})`

        expect(res).to.deep.include({
          bookId: 201,
          source: 'runtime2',
          writer: 'Emily Brontë'
        })

        const resDeployed = await cds.ql`
          SELECT id as bookId, AuthorName as writer, 'runtime2' as source
          FROM ${DBView2}
          WHERE id IN (
            SELECT ID
            FROM ${DBView0}
            WHERE ID = ${201})`
        expect(res).to.deep.equal(resDeployed)
      })

      test('depth 3 with subselect and aggregations', async () => {
        const { Book: RTView0 } = cds.entities('runtimeViews0Service')
        const { Book: RTView1 } = cds.entities('runtimeViews1Service')
        const { Book: RTView2 } = cds.entities('runtimeViews2Service')
        const { Book: DBView0 } = cds.entities('views0Service')
        const { Book: DBView1 } = cds.entities('views1Service')
        const { Book: DBView2 } = cds.entities('views2Service')

        const res = await cds.ql`
          SELECT title,
                 COUNT(*) as bookCount,
                 MIN(ID) as minBookId,
                 MAX(ID) as maxBookId
          FROM ${RTView0}
          WHERE ID IN (
            SELECT id FROM ${RTView1}
            WHERE id IN (
              SELECT ID FROM ${RTView0}
              WHERE ID > (
                SELECT MIN(ID) FROM ${RTView0}
                WHERE ID < 250
              )
            )
            AND authorName IN (
              SELECT DISTINCT AuthorName FROM ${RTView2}
              WHERE AuthorName IS NOT NULL
            )
          )
          GROUP BY title
          HAVING COUNT(*) >= 1
          ORDER BY bookCount DESC, title`

        expect(res).to.deep.include({
          bookCount: 1,
          maxBookId: 271,
          minBookId: 271,
          title: 'Catweazle'
        })

        const resDeployed = await cds.ql`
          SELECT title,
                 COUNT(*) as bookCount,
                 MIN(ID) as minBookId,
                 MAX(ID) as maxBookId
          FROM ${DBView0}
          WHERE ID IN (
            SELECT id FROM ${DBView1}
            WHERE id IN (
              SELECT ID FROM ${DBView0}
              WHERE ID > (
                SELECT MIN(ID) FROM ${DBView0}
                WHERE ID < 250
              )
            )
            AND authorName IN (
              SELECT DISTINCT AuthorName FROM ${DBView2}
              WHERE AuthorName IS NOT NULL
            )
          )
          GROUP BY title
          HAVING COUNT(*) >= 1
          ORDER BY bookCount DESC, title`
        expect(res).to.deep.equal(resDeployed)
      })

      test('depth 3 with complex subquery', async () => {
        const { Book: RTView1 } = cds.entities('runtimeViews1Service')
        const { Book: RTView2 } = cds.entities('runtimeViews2Service')
        const { Book: DBView1 } = cds.entities('views1Service')
        const { Book: DBView2 } = cds.entities('views2Service')

        const res = await cds.ql`SELECT AuthorName, id,
                 (SELECT COUNT(*) FROM ${RTView1} as sub WHERE sub.authorName = outer.AuthorName) as sameAuthorCount
                 FROM ${RTView2} as outer
                 WHERE outer.id IN (SELECT id FROM ${RTView1} WHERE id < 250)
                 ORDER BY AuthorName`

        expect(res).to.deep.include({
          AuthorName: 'Charlotte Brontë',
          id: 207,
          sameAuthorCount: 1
        })

        const resDeployed = await cds.ql`SELECT AuthorName, id,
                 (SELECT COUNT(*) FROM ${DBView1} as sub WHERE sub.authorName = outer.AuthorName) as sameAuthorCount
                 FROM ${DBView2} as outer
                 WHERE outer.id IN (SELECT id FROM ${DBView1} WHERE id < 250)
                 ORDER BY AuthorName`
        expect(res).to.deep.equal(resDeployed)
      })

      test('depth 3 with duplicate references - ID_Renamed, ID_Renamed_Again', async () => {
        const { Book_Renamed: RTView0_Renamed } = cds.entities('runtimeViews0Service')
        const { Book: RTView1 } = cds.entities('runtimeViews1Service')
        const { Book: RTView2 } = cds.entities('runtimeViews2Service')
        const { Book_Renamed: DBView0_Renamed } = cds.entities('views0Service')
        const { Book: DBView1 } = cds.entities('views1Service')
        const { Book: DBView2 } = cds.entities('views2Service')

        // test deduplication logic to ensure proper behavior
        const res = await cds.ql`SELECT AuthorName, id,
                 (SELECT COUNT(*) FROM ${RTView1} as sub WHERE sub.authorName = outer.AuthorName) as sameAuthorCount
                 FROM ${RTView2} as outer
                 WHERE outer.id IN (SELECT ID_Renamed FROM ${RTView0_Renamed} WHERE ID_Renamed < 250)
                 ORDER BY AuthorName`

        expect(res).to.deep.include(
          {
          AuthorName: 'Charlotte Brontë',
          id: 207,
          sameAuthorCount: 1
          },
          {
          AuthorName: 'Emily Brontë',
          id: 201,
          sameAuthorCount: 1
          }
        )

        // Verify deployed view works
        const resDeployed = await cds.ql`SELECT AuthorName, id,
                 (SELECT COUNT(*) FROM ${DBView1} as sub WHERE sub.authorName = outer.AuthorName) as sameAuthorCount
                 FROM ${DBView2} as outer
                 WHERE outer.id IN (SELECT ID_Renamed FROM ${DBView0_Renamed} WHERE ID_Renamed < 250)
                 ORDER BY AuthorName`
        expect(res).to.deep.equal(resDeployed)
      })

      test('depth 2 with subselect with EXISTS clause', async () => {
        const { Book: RTView0 } = cds.entities('runtimeViews0Service')
        const { Book: RTView1 } = cds.entities('runtimeViews1Service')
        const { Book: DBView0 } = cds.entities('views0Service')
        const { Book: DBView1 } = cds.entities('views1Service')

        const res = await cds.ql`SELECT ID, title FROM ${RTView0} as main
                 WHERE EXISTS (
                   SELECT 1 FROM ${RTView1} as proj
                   WHERE proj.id = main.ID
                   AND proj.authorName LIKE '%Brontë%'
                 )
                 AND main.ID BETWEEN 200 AND 210
                 ORDER BY main.ID`

        expect(res).to.deep.include({
          ID: 201,
          title: 'Wuthering Heights'
        })

        // Verify deployed view works
        const resDeployed = await cds.ql`SELECT ID, title FROM ${DBView0} as main
                 WHERE EXISTS (
                   SELECT 1 FROM ${DBView1} as proj
                   WHERE proj.id = main.ID
                   AND proj.authorName LIKE '%Brontë%'
                 )
                 AND main.ID BETWEEN 200 AND 210
                 ORDER BY main.ID`
        expect(res).to.deep.equal(resDeployed)
      })

      test('depth 3 with filter, and ordering', async () => {
        const { Book: RTView } = cds.entities('runtimeViews2Service')
        const { Book: DBView } = cds.entities('views2Service')
        const res = await SELECT.from(RTView)
          .columns(['id', 'title', 'AuthorName'])
          .where('id = 201 or id = 207')
          .orderBy('title')

        expect(res).to.deep.equal([{
          id: 207,
          title: 'Jane Eyre',
          AuthorName: 'Charlotte Brontë',
        }, {
          id: 201,
          title: 'Wuthering Heights',
          AuthorName: 'Emily Brontë',
        }])

        const resDeployed = await SELECT.from(DBView)
          .columns(['id', 'title', 'AuthorName'])
          .where('id = 201 or id = 207')
          .orderBy('title')
        expect(res).to.deep.equal(resDeployed)
      })

      test('depth 3 - group by with aggregate count', async () => {
        const { Book: RTView } = cds.entities('runtimeViews2Service')
        const { Book: DBView } = cds.entities('views2Service')
        const res = await SELECT.from(RTView)
          .columns(['AuthorName', 'count(*) as books'])
          .where('AuthorName IS NOT NULL')
          .groupBy('AuthorName')
          .orderBy('AuthorName')

        expect(res).to.deep.equal([
          { AuthorName: 'Charlotte Brontë', books: 1 },
          { AuthorName: 'Edgar Allen Poe', books: 2 },
          { AuthorName: 'Emily Brontë', books: 2 },
          { AuthorName: 'Richard Carpenter', books: 1 }
        ])


        const resDeployed = await SELECT.from(DBView)
          .columns(['AuthorName', 'count(*) as books'])
          .where('AuthorName IS NOT NULL')
          .groupBy('AuthorName')
          .orderBy('AuthorName')
        expect(res).to.deep.equal(resDeployed)
      })
    })

    describe('view with JOIN', () => {
      test('with existing entity', async () => {
        const { BookWithEditions_Existing: RTView } = cds.entities('runtimeViews0Service')
        const res = await SELECT.from(RTView)
        expect(res).to.deep.include({
          ID: 201,
          title: 'Wuthering Heights',
          editionID: 201,
        })
      })

      test('with runtime views', async () => {
        const { BookWithEditions_RTV: RTView } = cds.entities('runtimeViews0Service')
        const res = await SELECT.from(RTView)
        expect(res).to.deep.include({
          ID: 201,
          title: 'Wuthering Heights',
          editionID: 201,
        })
      })

      test('with aliased runtime views', async () => {
        const { BookWithEditions_Aliased: RTView } = cds.entities('runtimeViews0Service')
        const res = await SELECT.from(RTView)
        expect(res).to.deep.include({
          ID: 201,
          title: 'Wuthering Heights',
          editionID: 201,
        })
      })
    })

    describe('Redirected views', () => {
      test('runtime with books redirected', async () => {
        const { AuthorRedirected: RTView } = cds.entities('runtimeViews0Service')
        const { AuthorRedirected: DBView } = cds.entities('views0Service')
        const res = await SELECT.one.from(RTView).columns(['ID', { expand: [{ ref: ['title'] }], ref: ['books'] }]).where({ ID: 101 })
        expect(res).to.deep.include({
          ID: 101,
          books: [
            { title: 'Redirected Wuthering Heights' },
            { title: 'Redirected dracula' }
          ]
        })
        const resDeployed = await SELECT.one.from(DBView).columns(['ID', { expand: [{ ref: ['title'] }], ref: ['books'] }]).where({ ID: 101 })
        expect(res).to.deep.equal(resDeployed)
      })
    })
  })

  describe('Error Cases', () => {
    test('virtual entities should throw error', async () => {
      const { VirtualBookView } = cds.entities('runtimeViewsErrorService')
      await expect(cds.ql`select from ${VirtualBookView}`).to.be.rejectedWith(/is not a runtime view/)
    })

    test('excluded fields should not be accessible', async () => {
      const { Book: RTView } = cds.entities('runtimeViews2Service')
      await expect(SELECT.from(RTView).columns(['stock'])).to.be.rejectedWith(/"stock" not found/)
    })

    test('excluded fields with alias should not be accessible', async () => {
      const { Book: RTView } = cds.entities('runtimeViews2Service')
      await expect(SELECT.from(RTView).columns(['stock'])).to.be.rejectedWith(/"stock" not found/)
    })

    test('view with UNION should throw DB error', async () => {
      const { AuthorsAndBooks: RTView } = cds.entities('runtimeViews0Service')
      await expect(SELECT.from(RTView)).to.be.rejectedWith(/”UNION” based queries are not supported/)
    })

    test('query with JOIN should throw DB error', async () => {
      const { Book: RTView0 } = cds.entities('runtimeViews0Service')
      const { Author: RTAuthor } = cds.entities('runtimeViews0Service')
      await expect(cds.ql`SELECT b.ID, b.title, a.name as authorName
                FROM ${RTView0} as b
                LEFT OUTER JOIN ${RTAuthor} as a ON a.ID = b.author_ID
                WHERE b.ID IN (201, 207)
                ORDER BY b.ID`).to.be.rejectedWith(/no such table|invalid table name|does not exist/)
    })
  })
})