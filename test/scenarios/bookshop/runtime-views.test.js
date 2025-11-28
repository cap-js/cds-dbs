const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

describe('Runtime Views', () => {
  const { expect } = cds.test(bookshop)
  if(cds.env.sql.names === 'quoted') return 'skipped'

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
        const res = await SELECT.from(RTView).where({ ID: 201 })
        expect(res).to.have.length(1)
        expect(res[0]).to.include({
          ID: 201,
          title: 'Wuthering Heights',
        })
        const resDeployed = await SELECT.from(DBView).where({ ID: 201 })
        expect(res).to.deep.equal(resDeployed)
      })

      test('runtimeViews1.Book with id field and author should return correct book data', async () => {
        const { Book: RTView } = cds.entities('runtimeViews1Service')
        const { Book: DBView } = cds.entities('views1Service')
        const res = await SELECT.from(RTView).where({ id: 201 })
        expect(res).to.have.length(1)
        expect(res[0]).to.include({
          id: 201,
          title: 'Wuthering Heights',
          authorName: 'Emily Brontë',
          author_dateOfBirth: '1818-07-30',
          author_placeOfBirth: 'Thornton, Yorkshire',
        })
        const resDeployed = await SELECT.from(DBView).where({ id: 201 })
        expect(res).to.deep.equal(resDeployed)
      })
    })

    describe('Projections and Expansions', () => {
      test('nested projection with basic fields', async () => {
        const { Book: RTView } = cds.entities('runtimeViews2Service')
        const { Book: DBView } = cds.entities('views2Service')
        const res = await SELECT.from(RTView).columns(['id']).where({ id: 201 })

        expect(res).to.have.length(1)
        expect(res[0]).to.include({
          id: 201,
        })

        const resDeployed = await SELECT.from(DBView).columns(['id']).where({ id: 201 })
        expect(res).to.deep.equal(resDeployed)
      })

      test('nested projection with expand', async () => {
        const { Book: RTView } = cds.entities('runtimeViews2Service')
        const { Book: DBView } = cds.entities('views2Service')
        const res = await SELECT.from(RTView).columns(['id', 'Authorid']).where({ id: 201 })

        expect(res).to.have.length(1)
        expect(res[0]).to.include({
          id: 201,
          Authorid: 101,
        })

        const resDeployed = await SELECT.from(DBView).columns(['id', 'Authorid']).where({ id: 201 })
        expect(res).to.deep.equal(resDeployed)
      })
    })

    describe('Aliases and Complex Queries', () => {
      test('select with alias by ID', async () => {
        const { Book: RTView } = cds.entities('runtimeViews2Service')
        const { Book: DBView } = cds.entities('views2Service')
        const res = await SELECT.from(RTView)
          .columns(['id', 'title', 'AuthorName'])
          .where({ id: 201 })

        expect(res).to.have.length(1)
        expect(res[0]).to.include({
          id: 201,
          title: 'Wuthering Heights',
          AuthorName: 'Emily Brontë',
        })

        const resDeployed = await SELECT.from(DBView)
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

        expect(res).to.have.length(2)
        expect(res[0]).to.include({
          id: 207,
          title: 'Jane Eyre',
          AuthorName: 'Charlotte Brontë',
        })
        expect(res[1]).to.include({
          id: 201,
          title: 'Wuthering Heights',
          AuthorName: 'Emily Brontë',
        })

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
            { AuthorName: 'Edgar Allen Poe', books: 2},
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
        const res = await cds.ql`select from ${RTView} { ID, books { title } } where ID = ${101}`
        expect(res).to.have.length(1)
        expect(res[0]).to.deep.include({
          ID: 101,
          books: [
            { title: 'Redirected Wuthering Heights' }
          ]
        })
        const resDeployed = await SELECT.from(DBView).columns(['ID', { expand: [{ref: ['title']}], ref: ['books'] }]).where({ ID: 101 })
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
        await expect(SELECT.from(RTView)).to.be.rejectedWith(/no such table|invalid table name|does not exist/)
      })

      test('View with JOIN should throw DB error', async () => {
        const { BookWithEditions: RTView } = cds.entities('runtimeViews0Service')
        await expect(SELECT.from(RTView)).to.be.rejectedWith(/no such table|invalid table name|does not exist/)
      })
    })
  })
})
