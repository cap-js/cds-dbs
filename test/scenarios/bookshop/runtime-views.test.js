const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

const { fail } = require('assert')

describe('Runtime Views', () => {
  cds.test(bookshop)
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
        const res = await SELECT.from('runtimeViews0Service.Book').where({ ID: 201 })
        expect(res).toHaveLength(1)
        expect(res[0]).toMatchObject({
          ID: 201,
          title: 'Wuthering Heights',
        })
        const resDeployed = await SELECT.from('views0Service.Book').where({ ID: 201 })
        expect(res).toEqual(resDeployed)
      })

      test('runtimeViews1.Book with id field and author should return correct book data', async () => {
        const res = await SELECT.from('runtimeViews1Service.Book').where({ id: 201 })
        expect(res).toHaveLength(1)
        expect(res[0]).toMatchObject({
          id: 201,
          title: 'Wuthering Heights',
          authorName: 'Emily Brontë',
          author_dateOfBirth: '1818-07-30',
          author_placeOfBirth: 'Thornton, Yorkshire',
        })
        const resDeployed = await SELECT.from('views1Service.Book').where({ id: 201 })
        expect(res).toEqual(resDeployed)
      })
    })

    describe('Projections and Expansions', () => {
      test('nested projection with basic fields', async () => {
        const res = await SELECT.from('runtimeViews2Service.Book').columns(['id']).where({ id: 201 })

        expect(res).toHaveLength(1)
        expect(res[0]).toMatchObject({
          id: 201,
        })

        const resDeployed = await SELECT.from('views2Service.Book').columns(['id']).where({ id: 201 })
        expect(res).toEqual(resDeployed)
      })

      test('nested projection with expand', async () => {
        const res = await SELECT.from('runtimeViews2Service.Book').columns(['id', 'Authorid']).where({ id: 201 })

        expect(res).toHaveLength(1)
        expect(res[0]).toMatchObject({
          id: 201,
          Authorid: 101,
        })

        const resDeployed = await SELECT.from('views2Service.Book').columns(['id', 'Authorid']).where({ id: 201 })
        expect(res).toEqual(resDeployed)
      })
    })

    describe('Aliases and Complex Queries', () => {
      test('select with alias by ID', async () => {
        const res = await SELECT.from('runtimeViews2Service.Book')
          .columns(['id', 'title', 'AuthorName'])
          .where({ id: 201 })

        expect(res).toHaveLength(1)
        expect(res[0]).toMatchObject({
          id: 201,
          title: 'Wuthering Heights',
          AuthorName: 'Emily Brontë',
        })

        const resDeployed = await SELECT.from('views2Service.Book')
          .columns(['id', 'title', 'AuthorName'])
          .where({ id: 201 })
        expect(res).toEqual(resDeployed)
      })

      test('select with alias, filter, and ordering', async () => {
        const res = await SELECT.from('runtimeViews2Service.Book')
          .columns(['id', 'title', 'AuthorName'])
          .where('id = 201 or id = 207')
          .orderBy('title')

        expect(res).toHaveLength(2)
        expect(res[0]).toMatchObject({
          id: 207,
          title: 'Jane Eyre',
          AuthorName: 'Charlotte Brontë',
        })
        expect(res[1]).toMatchObject({
          id: 201,
          title: 'Wuthering Heights',
          AuthorName: 'Emily Brontë',
        })

        const resDeployed = await SELECT.from('views2Service.Book')
          .columns(['id', 'title', 'AuthorName'])
          .where('id = 201 or id = 207')
          .orderBy('title')
        expect(res).toEqual(resDeployed)
      })
    })

    describe('Aggregations and Distinct Queries', () => {
      test('distinct author selection', async () => {
        const res = await SELECT.from('runtimeViews0Service.Book')
          .columns([{ ref: ['author'], expand: ['*'] }])
          .where('ID != 201')

        const authors = res.map(b => b.author.name)
        expect(authors).toEqual(expect.arrayContaining(['Charlotte Brontë', 'Edgar Allen Poe', 'Richard Carpenter']))

        const resDeployed = await SELECT.from('views0Service.Book')
          .columns([{ ref: ['author'], expand: ['*'] }])
          .where('ID != 201')
        expect(res).toEqual(resDeployed)
      })

      test('group by with aggregate count', async () => {
        const res = await SELECT.from('runtimeViews2Service.Book')
          .columns(['AuthorName', 'count(*) as books'])
          .where('AuthorName IS NOT NULL')
          .groupBy('AuthorName')

        expect(res).toEqual(
          expect.arrayContaining([
            { AuthorName: 'Charlotte Brontë', books: 1 },
            { AuthorName: 'Emily Brontë', books: 1 },
          ]),
        )

        const resDeployed = await SELECT.from('views2Service.Book')
          .columns(['AuthorName', 'count(*) as books'])
          .where('AuthorName IS NOT NULL')
          .groupBy('AuthorName')
        expect(res).toEqual(resDeployed)
      })
    })

    describe('Redirected views', () => {
      test('runtime with books redirected', async () => {
        const res = await SELECT.from('runtimeViews0Service.AuthorRedirected').columns(['ID', { expand: [{ref: ['title']}], ref: ['books'] }]).where({ ID: 101 })
        expect(res).toHaveLength(1)
        expect(res[0]).toMatchObject({
          ID: 101,
          books: [
            { title: 'Redirected Wuthering Heights' }
          ]
        })
        const resDeployed = await SELECT.from('views0Service.AuthorRedirected').columns(['ID', { expand: [{ref: ['title']}], ref: ['books'] }]).where({ ID: 101 })
        expect(res).toEqual(resDeployed)
      })
    })
  })

  describe('Error Cases', () => {
    describe('Unsupported Entity Types', () => {
      test('Virtual entities should throw error', async () => {
        const { VirtualBookView } = cds.entities('runtimeViewsErrorService')
        await expect(cds.ql`select from ${VirtualBookView }).rejected
          .to.eq(/is not a runtime view/) // the way to validate the error object is not very straight forward
      })

      test('Remote entities should throw error', async () => {
        try {
          await SELECT.from('runtimeViewsErrorService.BusinessPartners')
          fail('Expected request to throw an error')
        } catch (error) {
          expect(error.message).toMatch(/is not a runtime view/)
        }
      })
    })

    describe('Field Access Restrictions', () => {
      test('excluded fields should not be accessible', async () => {
        try {
          await SELECT.from('runtimeViews2Service.Book').columns(['stock'])
          fail('Expected request to throw an error')
        } catch (error) {
          expect(error.message).toMatch(/stock/)
        }
      })

      test('excluded fields with alias should not be accessible', async () => {
        try {
          await SELECT.from('runtimeViews2Service.Book').columns(['stock'])
          fail('Expected request to throw an error')
        } catch (error) {
          expect(error.message).toMatch(/stock/)
        }
      })

      test('View with UNION should throw DB error', async () => {
        try {
          await SELECT.from('runtimeViews0Service.AuthorsAndBooks')
          fail('Expected request to throw an error')
        } catch (error) {
          expect(error.message).toMatch(/no such table|invalid table name|does not exist/)
        }
      })

      test('View with JOIN should throw DB error', async () => {
        try {
          await SELECT.from('runtimeViews0Service.BookWithEditions')
          fail('Expected request to throw an error')
        } catch (error) {
          expect(error.message).toMatch(/no such table|invalid table name|does not exist/)
        }
      })
    })
  })
})
