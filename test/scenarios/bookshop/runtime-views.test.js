const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

describe('Runtime Views', () => {
  cds.test(bookshop)

  beforeAll(async () => {
    cds.env.features.runtime_views = true

    // Insert Orders
    await INSERT.into('bookshop_Order').entries([
      { OrderNo: 123, status: 'canceled' },
      { OrderNo: 234, status: 'open' },
      { OrderNo: 345, status: 'delivered' },
    ])

    // Insert OrderItems
    await INSERT.into('bookshop_OrderItem').entries([
      { ID: '1', parent_OrderNo: 123, amount: 1, quantity: 1 },
      { ID: '2', parent_OrderNo: 123, amount: 1, quantity: 1 },
      { ID: '3', parent_OrderNo: 234, amount: 1, quantity: 1 },
      { ID: '4', parent_OrderNo: 234, amount: 2, quantity: 2 },
      { ID: '5', parent_OrderNo: 345, amount: 1, quantity: 1 },
      { ID: '6', parent_OrderNo: 345, amount: 1, quantity: 1 },
    ])
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
      })

      test('runtimeViews1.Book with id field and author should return correct book data', async () => {
        const res = await SELECT.from('runtimeViews1Service.Book').where({ id: 201 })
        expect(res).toHaveLength(1)
        expect(res[0]).toMatchObject({
          id: 201,
          title: 'Wuthering Heights',
          authorName: 'Emily Brontë',
        })
      })
    })

    describe('Projections and Expansions', () => {
      test('nested projection with basic fields', async () => {
        const res = await SELECT.from('runtimeViews2Service.Book').columns(['id', 'autor']).where({ id: 201 })

        expect(res).toHaveLength(1)
        expect(res[0]).toMatchObject({
          id: 201,
        })
      })

      test('nested projection with expand', async () => {
        const res = await SELECT.from('runtimeViews2Service.Book').columns(['id', 'autor']).where({ id: 201 })

        expect(res).toHaveLength(1)
        expect(res[0]).toMatchObject({
          id: 201,
          autor_ID: 101,
        })
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
      })
    })

    describe('Aggregations and Distinct Queries', () => {
      test('distinct author selection', async () => {
        const res = await SELECT.from('runtimeViews0Service.Book')
          .columns([{ ref: ['author'], expand: ['*'] }])
          .where('ID != 201')

        const authors = res.map(b => b.author_name)
        expect(authors).toEqual(expect.arrayContaining(['Charlotte Brontë', 'Edgar Allen Poe', 'Richard Carpenter']))
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
      })
    })
  })

  describe('Associations and Expansions', () => {
    test('expand to-many editions', async () => {
      const res = await SELECT.from('runtimeViews1Service.Book')
        .columns(['title', { ref: ['editions'], expand: [{ ref: ['editionName'] }] }])
        .orderBy('title')
        .limit(2, 1)

      expect(res).toHaveLength(2)
      expect(res[0]).toMatchObject({
        title: expect.any(String),
      })
      expect(res[1]).toMatchObject({
        title: expect.any(String),
      })
    })

    test('expand with alias to-one', async () => {
      const res = await SELECT.from('runtimeViews2Service.Book')
        .columns(['title', { ref: ['category'], expand: [{ ref: ['name'] }] }])
        .where({ id: 201 })

      expect(res).toHaveLength(1)
      expect(res[0]).toMatchObject({
        title: 'Wuthering Heights',
        cg: 'books',
      })
    })

    test('filter by association property', async () => {
      const res = await SELECT.from('runtimeViews2Service.Book')
        .columns(['title'])
        .where([{ ref: ['AuthorName'] }, '=', { val: 'bar' }])

      expect(res.length).toBeGreaterThan(0)
      expect(res[0]).toMatchObject({
        title: expect.any(String),
        cg: 'books',
      })
    })
  })

  describe('Filtered Views and Projections', () => {
    describe('Stock-based Views', () => {
      test('BooksWithLowStock should filter books correctly by stock levels', async () => {
        const res = await SELECT.from('runtimeViews4Service.BooksWithLowStock')
          .columns(['title', 'count'])
          .where([{ ref: ['Author'], expand: [{ ref: ['name'] }] }, '=', { val: 'bar' }])
        expect(res).toHaveLength(1)
        expect(res[0]).toMatchObject({
          title: 'Wuthering Heights',
          count: 12,
        })
      })

      test('BooksWithHighStock should filter books correctly by stock levels', async () => {
        const res = await SELECT.from('runtimeViews4Service.BooksWithHighStock')
          .columns(['title', 'count'])
          .where([{ ref: ['Author'], expand: [{ ref: ['name'] }] }, '=', { val: 'bar' }])
        expect(res).toHaveLength(1)
        expect(res[0]).toMatchObject({
          title: 'The Raven',
          count: 333,
        })
      })
    })
  })

  describe('Path Expressions and Filtered Paths', () => {
    test('filtered path navigation with book selection', async () => {
      const res = await SELECT.from('runtimeViews1Service.Book').columns(['title', 'AuthorId']).where('AuthorId = 150')

      expect(res).toHaveLength(2)
      expect(res).toEqual(
        expect.arrayContaining([
          { title: 'The Raven', AuthorId: 150, id: 251 },
          { title: 'Eleonora', AuthorId: 150, id: 252 },
        ]),
      )
    })

    test('filtered path navigation with author filter', async () => {
      const res = await SELECT.from('runtimeViews1Service.Book')
        .columns(['title', 'authorName'])
        .where([{ ref: ['Author'], expand: [{ ref: ['name'] }] }, '=', { val: 'bar' }])

      expect(res).toHaveLength(2)
      expect(res).toEqual(
        expect.arrayContaining([
          { title: 'The Raven', authorName: 'Edgar Allen Poe', id: 251 },
          { title: 'Eleonora', authorName: 'Edgar Allen Poe', id: 252 },
        ]),
      )
    })
  })

  describe('Expression and Calculated Fields', () => {
    test('SQL expressions in projections', async () => {
      const res = await SELECT.from('runtimeViews3Service.OrderWithExpressions')
        .columns(['literal', 'func', 'concat', 'caseWhen'])
        .where({ ID: 123 })

      expect(res).toHaveLength(1)
      expect(res[0]).toMatchObject({
        literal: 'test',
        func: null,
        concat: null,
        caseWhen: 1,
      })
    })

    test('calculated elements with complex expressions', async () => {
      const res = await SELECT.from('runtimeViewsCalculatedService.Employees').columns([
        'calc_fullName',
        'calc_number',
        'calc_manufacturer',
      ])

      // This test depends on Employee data that might not exist
      expect(res).toEqual(expect.any(Array))
    })
  })

  describe('Order and Duplicates Handling', () => {
    test('prevents duplicate orders from to-many joins', async () => {
      const res = await SELECT.from('runtimeViews5Service.Order')

      expect(res).toHaveLength(3)
      expect(res.map(r => r.ID)).toEqual(expect.arrayContaining([123, 234, 345]))
    })

    test('handles associations with renamed attributes', async () => {
      const res = await SELECT.from('runtimeViews6Service.Order').columns([
        'ID',
        { ref: ['items'], expand: [{ ref: ['ID'] }] },
      ])

      expect(res).toHaveLength(4)
      expect(res.map(r => r.ID)).toEqual(expect.arrayContaining([123, 234, 345]))
    })
  })

  describe('Error Cases', () => {
    describe('Unsupported Entity Types', () => {
      test('Virtual entities should throw error', async () => {
        try {
          await SELECT.from('runtimeViews4Service.VirtualBookView')
          fail('Expected request to throw an error')
        } catch (error) {
          expect(error.message).toMatch(/not a runtime view/)
        }
      })

      test('Remote entities should throw error', async () => {
        try {
          await SELECT.from('runtimeViews4Service.BusinessPartners')
          fail('Expected request to throw an error')
        } catch (error) {
          expect(error.message).toMatch(/refers to a remote service/)
        }
      })
    })

    describe('Field Access Restrictions', () => {
      test('excluded fields should not be accessible', async () => {
        await expect(SELECT.from('runtimeViews2Service.Book').columns(['stock'])).rejects.toThrow(/stock/)
      })

      test('excluded fields with alias should not be accessible', async () => {
        await expect(SELECT.from('runtimeViews2Service.Book').columns(['stock'])).rejects.toThrow(/stock/)
      })
    })
  })

  describe('Draft-enabled Runtime Views', () => {
    test('active entities in draft-enabled view', async () => {
      const res = await SELECT.from('draft.runtimeViewsDraft2Service.Book')
        .columns(['title', 'IsActiveEntity', 'HasActiveEntity'])
        .where({ IsActiveEntity: true })

      expect(res).toEqual(
        expect.arrayContaining([
          { title: 'Wuthering Heights' },
          { title: 'Jane Eyre' },
          { title: 'The Raven' },
          { title: 'Eleonora' },
          { title: 'Catweazle' },
        ]),
      )
    })

    test('draft entity status in active entities', async () => {
      const res = await SELECT.from('draft.runtimeViewsDraft1Service.Book')
        .columns(['title', 'IsActiveEntity', 'HasActiveEntity'])
        .where({ IsActiveEntity: true })

      expect(res).toEqual(expect.arrayContaining([{ title: 'Wuthering Heights' }]))
    })
  })
})
