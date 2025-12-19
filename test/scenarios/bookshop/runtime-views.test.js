const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

describe('Runtime Views', () => {
  const { expect } = cds.test(bookshop)

  beforeAll(async () => {
    cds.env.features.runtime_views = true
  })

  afterAll(() => {
    cds.env.features.runtime_views = false
  })

  describe('Basic Runtime View Operations', () => {
    describe('Basic Book Queries', () => {
      test('runtimeViews0.Book with ID field should return correct book data', async () => {
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

      test('runtimeViews0.Book with nested expand to different entities', async () => {
        const { Book: RTView } = cds.entities('runtimeViews0Service')
        const { Book: DBView } = cds.entities('views0Service')
        const res = await SELECT.one.from(RTView).columns(['ID', { expand: [{ ref: ['ID'] }], ref: ['pages'] }, { expand: [{ ref: ['name'] }, { expand: [{ ref: ['ID'] }], ref: ['reviews'] }], ref: ['author'] }]).where({ ID: 201 })
        expect(res).to.deep.include({
          ID: 201,
          author: {
            name: "Emily Brontë",
            reviews: []
          },
          pages: []
        })
        const resDeployed = await SELECT.one.from(DBView).columns(['ID', { expand: [{ ref: ['ID'] }], ref: ['pages'] }, { expand: [{ ref: ['name'] }, { expand: [{ ref: ['ID'] }], ref: ['reviews'] }], ref: ['author'] }]).where({ ID: 201 })
        expect(res).to.deep.equal(resDeployed)
      })

      test('runtimeViews0.Book with nested expand to different related entities', async () => {
        const { Book: RTView } = cds.entities('runtimeViews0Service')
        const { Book: DBView } = cds.entities('views0Service')
        const res = await SELECT.one.from(RTView).columns(['ID', { expand: [{ ref: ['ID'] }], ref: ['pages'] }, { expand: [{ ref: ['name'] }, { expand: [{ ref: ['ID'] }, { expand: [{ ref: ['ID'] }], ref: ['page'] }], ref: ['reviews'] }], ref: ['author'] }]).where({ ID: 201 })
        expect(res).to.deep.include({
          ID: 201,
          author: {
            name: "Emily Brontë",
            reviews: []
          },
          pages: []
        })
        const resDeployed = await SELECT.one.from(DBView).columns(['ID', { expand: [{ ref: ['ID'] }], ref: ['pages'] }, { expand: [{ ref: ['name'] }, { expand: [{ ref: ['ID'] }, { expand: [{ ref: ['ID'] }], ref: ['page'] }], ref: ['reviews'] }], ref: ['author'] }]).where({ ID: 201 })
        expect(res).to.deep.equal(resDeployed)
      })

      test('runtimeViews0.Book with nested expand to the same entity', async () => {
        const { Book: RTView } = cds.entities('runtimeViews0Service')
        const { Book: DBView } = cds.entities('views0Service')
        const res = await SELECT.one.from(RTView).columns(['ID', { expand: [{ ref: ['ID'] }], ref: ['pages'] }, { expand: [{ ref: ['name'] }, { expand: [{ ref: ['ID'] }], ref: ['pages'] }], ref: ['author'] }]).where({ ID: 201 })
        expect(res).to.deep.include({
          ID: 201,
          author: {
            name: "Emily Brontë",
            pages: []
          },
          pages: []
        })
        const resDeployed = await SELECT.one.from(DBView).columns(['ID', { expand: [{ ref: ['ID'] }], ref: ['pages'] }, { expand: [{ ref: ['name'] }, { expand: [{ ref: ['ID'] }], ref: ['pages'] }], ref: ['author'] }]).where({ ID: 201 })
        expect(res).to.deep.equal(resDeployed)
      })

      test('runtimeViews0.Book with expand to this entity', async () => {
        const { Book: RTView } = cds.entities('runtimeViews0Service')
        const { Book: DBView } = cds.entities('views0Service')
        const res = await SELECT.one.from(RTView).columns(['ID', 'title', { expand: [{ ref: ['name'] }, { expand: [{ ref: ['ID'] }], ref: ['pages'] }], ref: ['author'] }, { expand: [{ ref: ['title'] }, { expand: [{ ref: ['ID'] }], ref: ['pages'] }], ref: ['this'] }]).where({ ID: 201 })
        expect(res).to.deep.include({
          ID: 201,
          author: {
            name: "Emily Brontë",
            pages: []
          },
          this: { pages: [], title: 'Wuthering Heights' },
          title: 'Wuthering Heights'
        })
        const resDeployed = await SELECT.one.from(DBView).columns(['ID', 'title', { expand: [{ ref: ['name'] }, { expand: [{ ref: ['ID'] }], ref: ['pages'] }], ref: ['author'] }, { expand: [{ ref: ['title'] }, { expand: [{ ref: ['ID'] }], ref: ['pages'] }], ref: ['this'] }]).where({ ID: 201 })
        expect(res).to.deep.equal(resDeployed)
      })

      test('runtimeViews1.Book with id field and author should return correct book data', async () => {
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
    })

    describe('Projections and Expansions', () => {
      test('nested projection with basic fields', async () => {
        const { Book: RTView } = cds.entities('runtimeViews2Service')
        const { Book: DBView } = cds.entities('views2Service')
        const res = await SELECT.one.from(RTView).columns(['id']).where({ id: 201 })
        expect(res).to.deep.include({
          id: 201,
        })

        const resDeployed = await SELECT.one.from(DBView).columns(['id']).where({ id: 201 })
        expect(res).to.deep.equal(resDeployed)
      })

      test('nested projection with expand', async () => {
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

      test('where exists query across different runtime view services with field aliasing', async () => {
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

      test('deeply nested subquery with aggregations', async () => {
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

      test('runtime view with complex subquery', async () => {
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

      test('runtime view with duplicate references', async () => {
        const { Books: RTView0, Book_Renamed: RTView0_Renamed } = cds.entities('runtimeViews0Service')
        const { Book: RTView1 } = cds.entities('runtimeViews1Service')
        const { Book: RTView2 } = cds.entities('runtimeViews2Service')

        const works = await cds.ql`SELECT AuthorName, id,
                 (SELECT COUNT(*) FROM ${RTView1} as sub WHERE sub.authorName = outer.AuthorName) as sameAuthorCount
                 FROM ${RTView2} as outer
                 WHERE outer.id IN (SELECT ID FROM ${RTView0} WHERE ID < 250)
                 ORDER BY AuthorName`

        // test deduplication logic to ensure proper behavior
        const broken = await cds.ql`SELECT AuthorName, id,
                 (SELECT COUNT(*) FROM ${RTView1} as sub WHERE sub.authorName = outer.AuthorName) as sameAuthorCount
                 FROM ${RTView2} as outer
                 WHERE outer.id IN (SELECT ID_Renamed FROM ${RTView0_Renamed} WHERE ID_Renamed < 250)
                 ORDER BY AuthorName`
      })

      test('runtime view with EXISTS clause', async () => {
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

      test('runtime view with JOIN on existing entities', async () => {
        const { BookWithEditions_Existing: RTView } = cds.entities('runtimeViews0Service')
        const res = await SELECT.from(RTView)
        expect(res).to.deep.include({
          ID: 201,
          title: 'Wuthering Heights',
          editionID: null,
        })
      })

      test('runtime view with JOIN on runtime views', async () => {
        const { BookWithEditions_RTV: RTView } = cds.entities('runtimeViews0Service')
        const res = await SELECT.from(RTView)
        expect(res).to.deep.include({
          ID: 201,
          title: 'Wuthering Heights',
          editionID: null,
        })
      })

      test('runtime view with JOIN with custom', async () => {
        const { BookWithEditions_Aliased: RTView } = cds.entities('runtimeViews0Service')
        const res = await SELECT.from(RTView)
        expect(res).to.deep.include({
          ID: 201,
          title: 'Wuthering Heights',
          editionID: null,
        })
      })
    })

    describe('Aliases and Complex Queries', () => {
      test('select with alias by ID', async () => {
        const { Book: RTView } = cds.entities('runtimeViews2Service')
        const { Book: DBView } = cds.entities('views2Service')
        const res = await SELECT.one.from(RTView)
          .columns(['id', 'title', 'AuthorName'])
          .where({ id: 201 })

        expect(res).to.deep.include({
          id: 201,
          title: 'Wuthering Heights',
          AuthorName: 'Emily Brontë',
        })

        const resDeployed = await SELECT.one.from(DBView)
          .columns(['id', 'title', 'AuthorName'])
          .where({ id: 201 })
        expect(res).to.deep.equal(resDeployed)
      })

      test('select with alias, filter, and ordering', async () => {
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
    })

    describe('Aggregations and Distinct Queries', () => {
      test('distinct author selection', async () => {
        const { Book: RTView } = cds.entities('runtimeViews0Service')
        const { Book: DBView } = cds.entities('views0Service')
        const res = await SELECT.from(RTView)
          .columns([{ ref: ['author'], expand: ['*'] }])
          .where('ID != 201')
          .orderBy('title')

        const authors = res.map(b => b.author.name)
        expect(authors).to.deep.equal(['Richard Carpenter', 'Edgar Allen Poe', 'Charlotte Brontë', 'Edgar Allen Poe'])

        const resDeployed = await SELECT.from(DBView)
          .columns([{ ref: ['author'], expand: ['*'] }])
          .where('ID != 201')
          .orderBy('title')
        expect(res).to.deep.equal(resDeployed)
      })

      test('group by with aggregate count', async () => {
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
          { AuthorName: 'Emily Brontë', books: 1 },
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

    describe('Redirected views', () => {
      test('runtime with books redirected', async () => {
        const { AuthorRedirected: RTView } = cds.entities('runtimeViews0Service')
        const { AuthorRedirected: DBView } = cds.entities('views0Service')
        const res = await SELECT.one.from(RTView).columns(['ID', { expand: [{ ref: ['title'] }], ref: ['books'] }]).where({ ID: 101 })
        expect(res).to.deep.include({
          ID: 101,
          books: [
            { title: 'Redirected Wuthering Heights' }
          ]
        })
        const resDeployed = await SELECT.one.from(DBView).columns(['ID', { expand: [{ ref: ['title'] }], ref: ['books'] }]).where({ ID: 101 })
        expect(res).to.deep.equal(resDeployed)
      })
    })
  })

  describe('Error Cases', () => {
    describe('Unsupported Entity Types', () => {
      test('Virtual entities should throw error', async () => {
        const { VirtualBookView } = cds.entities('runtimeViewsErrorService')
        await expect(cds.ql`select from ${VirtualBookView}`).to.be.rejectedWith(/is not a runtime view/)
      })
    })

    describe('Field Access Restrictions', () => {
      test('excluded fields should not be accessible', async () => {
        const { Book: RTView } = cds.entities('runtimeViews2Service')
        await expect(SELECT.from(RTView).columns(['stock'])).to.be.rejectedWith(/"stock" not found/)
      })

      test('excluded fields with alias should not be accessible', async () => {
        const { Book: RTView } = cds.entities('runtimeViews2Service')
        await expect(SELECT.from(RTView).columns(['stock'])).to.be.rejectedWith(/"stock" not found/)
      })

      test('View with UNION should throw DB error', async () => {
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
})