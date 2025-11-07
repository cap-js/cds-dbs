const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

describe('Runtime Views', () => {
  const { expect, GET, POST, PUT, DELETE } = cds.test(bookshop)
  
  let srv, model, tx
  beforeAll(async () => {
    srv = await cds.connect.to('db')
    model = cds.model
  })

  beforeEach(async () => {
    tx = srv.tx()
  })

  afterEach(async () => {
    await tx.rollback()
  })

  describe('Basic Runtime View Operations', () => {
    
    test('testClientCreation', async () => {
      expect(srv).toBeDefined()
      expect(srv).toHaveProperty('run')
    })

    test('testSelectAll_whereId - from runtimeViews1.Book', async () => {
      const BOOK = 'runtimeViews1.Book'
      const query = SELECT.from(BOOK).where({ id: 201 })
      
      const books = await tx.run(query)
      
      expect(books).toHaveLength(1)
      expect(books[0]).toMatchObject({
        id: 201,
        title: 'Wuthering Heights',
        authorName: 'Peter'
      })
    })

    test('testSelect_nestedProjection_whereId - from runtimeViews2.Book', async () => {
      const bookWithAuthorName = 'runtimeViews2.Book'
      const query = SELECT.from(bookWithAuthorName).columns('id', 'autor').where({ id: 201 })
      
      const books = await tx.run(query)
      
      expect(books).toHaveLength(1)
      expect(books[0]).toMatchObject({
        id: 201,
        autor: {
          id: 1,
          nombre: 'Peter'
        }
      })
    })

    test('testSelect_withAlias_byId', async () => {
      const query = SELECT.from('runtimeViews2.Book')
        .columns('id', 'title as Book', 'AuthorName')
        .where({ id: 201 })
      
      const books = await tx.run(query)
      
      expect(books).toHaveLength(1)
      expect(books[0]).toMatchObject({
        id: 201,
        Book: 'Wuthering Heights',
        AuthorName: 'Peter'
      })
    })

    test('testSelect_withAlias_whereIn_orderBy', async () => {
      const query = SELECT.from('runtimeViews2.Book')
        .columns('id', 'title as Book', 'AuthorName')
        .where({ id: { in: [201, 277] } })
        .orderBy('Book')
      
      const books = await tx.run(query)
      
      expect(books).toHaveLength(2)
      expect(books[0]).toMatchObject({
        id: 277,
        Book: 'Wikipedia',
        AuthorName: null
      })
      expect(books[1]).toMatchObject({
        id: 201,
        Book: 'Wuthering Heights',
        AuthorName: 'Peter'
      })
    })

    test('testSelect_distinct', async () => {
      const query = SELECT.distinct.from('runtimeViews0.Book')
        .columns('author.name as author')
        .where({ ID: { '!=': 277 } })
      
      const books = await tx.run(query)
      
      expect(books.map(b => b.author)).toEqual(expect.arrayContaining(['Emil', 'Peter']))
    })

    test('testSelect_groupBy_having', async () => {
      const query = SELECT.from('runtimeViews2.Book')
        .columns('AuthorName', 'count(distinct id) as books')
        .groupBy('AuthorName')
        .having({ AuthorName: { '!=': null } })
      
      const books = await tx.run(query)
      
      expect(books).toEqual(expect.arrayContaining([
        { AuthorName: 'Emil', books: 2 },
        { AuthorName: 'Peter', books: 1 }
      ]))
    })
  })

  describe('Associations and Expansions', () => {
    
    test('testSelect_Expand_toMany', async () => {
      const query = SELECT.from('runtimeViews1.Book')
        .columns('title', 'editions { editionName }')
        .limit(2, 1)
        .orderBy('title')
      
      const books = await tx.run(query)
      
      expect(books).toHaveLength(2)
      expect(books[0]).toMatchObject({
        title: 'The Raven',
        editions: expect.arrayContaining([
          { editionName: 'first' },
          { editionName: 'second' }
        ])
      })
      expect(books[1]).toMatchObject({
        title: 'Wikipedia',
        editions: []
      })
    })

    test('testSelect_ExpandWithAlias_toOne', async () => {
      const query = SELECT.from('runtimeViews2.Book')
        .columns('title', 'cat as catego { name as ry }')
        .where({ id: 201 })
      
      const books = await tx.run(query)
      
      expect(books).toHaveLength(1)
      expect(books[0]).toMatchObject({
        title: 'Wuthering Heights',
        catego: { ry: 'Novel' }
      })
    })

    test('testSelect_anyMatch', async () => {
      const query = SELECT.from('runtimeViews2.Book')
        .columns('title', 'cat.name as catego')
        .where(CQL`EXISTS cat[name = 'Novel']`)
      
      const books = await tx.run(query)
      
      expect(books).toHaveLength(1)
      expect(books[0]).toMatchObject({
        title: 'Wuthering Heights',
        catego: 'Novel'
      })
    })

    test('testSelect_search', async () => {
      const query = SELECT.from('runtimeViews2.Book')
        .columns('title', 'cat.name as cat')
        .where(CQL`contains(title, 'Height')`)
      
      const books = await tx.run(query)
      
      expect(books).toHaveLength(1)
      expect(books[0]).toMatchObject({
        title: 'Wuthering Heights',
        cat: 'Novel'
      })
    })
  })

  describe('Filtered Views and Projections', () => {
    
    test('testSelect_projectionWithWhere - BooksWithLowStock', async () => {
      const query = SELECT.from('runtimeViews.BooksWithLowStock')
        .columns('title', 'count as amount')
        .where({ 'publisher.name': 'Random House' })
      
      const books = await tx.run(query)
      
      expect(books).toHaveLength(1)
      expect(books[0]).toMatchObject({
        title: 'Wuthering Heights',
        amount: 12
      })
    })

    test('testSelect_projectionWithWhere - BooksWithHighStock', async () => {
      const query = SELECT.from('runtimeViews.BooksWithHighStock')
        .columns('title', 'count')
        .where(CQL`publisher.name like 'Random House%'`)
      
      const books = await tx.run(query)
      
      expect(books).toHaveLength(1)
      expect(books[0]).toMatchObject({
        title: 'The Raven',
        count: 333
      })
    })
  })

  describe('Path Expressions and Filtered Paths', () => {
    
    test('testSelectFromFilteredPath_toOne', async () => {
      const query = SELECT.from('runtimeViews1.Edition')
        .where({ editionNumber: '2' })
        .columns('parent { title, AuthorId, Author.name as author, editions { editionName } }')
      
      const result = await tx.run(query)
      
      expect(result).toHaveLength(1)
      const book = result[0].parent
      expect(book).toMatchObject({
        title: 'The Raven',
        AuthorId: 2,
        author: 'Emil'
      })
      expect(book.editions).toEqual(expect.arrayContaining([
        { editionName: 'first' },
        { editionName: 'second' }
      ]))
    })

    test('testSelectFromFilteredPath_toMany', async () => {
      const query = SELECT.from('runtimeViews1.Book')
        .where({ AuthorId: 2 })
        .columns('editions { editionNumber, editionName, parent { title } }')
      
      const result = await tx.run(query)
      
      expect(result).toHaveLength(1)
      expect(result[0].editions).toEqual(expect.arrayContaining([
        {
          editionNumber: '1',
          editionName: 'first',
          parent: { title: 'The Raven' }
        },
        {
          editionNumber: '2',
          editionName: 'second',
          parent: { title: 'The Raven' }
        }
      ]))
    })
  })

  describe('Expression and Calculated Fields', () => {
    
    test('testSelectExpressions', async () => {
      const query = SELECT.from('runtimeViews3.OrderWithExpressions')
        .where({ ID: 123 })
        .columns('literal', 'func', 'concat', 'caseWhen')
      
      const orders = await tx.run(query)
      
      expect(orders).toHaveLength(1)
      expect(orders[0]).toMatchObject({
        literal: 'test',
        func: 'CANCELED',
        concat: 'STATUS: canceled',
        caseWhen: -1
      })
    })

    test('testSelectWithCalculatedElements', async () => {
      const query = SELECT.from('runtimeViewsCalculated.Employees')
        .columns('calc_fullName', 'calc_number', 'calc_manufacturer')
      
      const result = await tx.run(query)
      
      expect(result).toEqual(expect.arrayContaining([
        {
          calc_fullName: 'John Mueller',
          calc_number: -230,
          calc_manufacturer: 'Acme Inc.'
        },
        {
          calc_fullName: 'John Mueller',
          calc_number: -230,
          calc_manufacturer: 'Flying Carpets LLC'
        },
        {
          calc_fullName: 'Carl Mueller',
          calc_number: null,
          calc_manufacturer: null
        }
      ]))
    })
  })

  describe('Order and Duplicates Handling', () => {
    
    test('testSelectOrder_noDuplicates', async () => {
      const query = SELECT.from('runtimeViews10.Order')
      
      const result = await tx.run(query)
      
      // No left join for (to-many) items assoc causing duplicate Orders
      expect(result).toHaveLength(3)
      expect(result.map(r => r.ID)).toEqual(expect.arrayContaining([123, 234, 345]))
    })

    test('testSelectOrder_filteredAssocWithRenamedAttribute', async () => {
      const query = SELECT.from('runtimeViews20.Order')
        .columns('ID', 'items { ID, quantity }')
      
      const result = await tx.run(query)
      
      expect(result).toEqual(expect.arrayContaining([
        {
          ID: 123,
          items: [
            { ID: 1, quantity: 1 },
            { ID: 2, quantity: 1 }
          ]
        },
        {
          ID: 234,
          items: [
            { ID: 3, quantity: 1 },
            { ID: 4, quantity: 2 }
          ]
        },
        {
          ID: 345,
          items: [
            { ID: 5, quantity: 1 },
            { ID: 6, quantity: 1 }
          ]
        }
      ]))
    })
  })

  describe('Error Cases', () => {
    
    test('testSelect_Unsupported - Virtual entities should throw', async () => {
      const query = SELECT.from('runtimeViews.VirtualBookView')
      
      await expect(tx.run(query)).rejects.toThrow()
    })

    test('testSelectExcludedThrows - Excluded fields should not be accessible', async () => {
      const query = SELECT.from('runtimeViews2.Book').columns('stock')
      
      await expect(tx.run(query)).rejects.toThrow(/stock/)
    })

    test('testSelectExcludedWithAliasThrows', async () => {
      const query = SELECT.from('runtimeViews2.Book').columns('stock as amount')
      
      await expect(tx.run(query)).rejects.toThrow(/stock/)
    })
  })

  describe('Draft-enabled Runtime Views', () => {
    
    test('testSelectFromDraftEnabledRuntimeView', async () => {
      const query = SELECT.from('draft.runtimeViews2.Book')
        .columns('title', 'IsActiveEntity', 'HasActiveEntity')
        .where({ IsActiveEntity: true })
      
      const books = await tx.run(query)
      
      expect(books).toEqual(expect.arrayContaining([
        { title: 'Wuthering Heights', IsActiveEntity: true, HasActiveEntity: false },
        { title: 'The Raven', IsActiveEntity: true, HasActiveEntity: false },
        { title: 'Catweazle', IsActiveEntity: true, HasActiveEntity: false },
        { title: 'Wikipedia', IsActiveEntity: true, HasActiveEntity: false }
      ]))
    })

    test('testSelectFromDraftEnabledRuntimeView_HasDraftEntity', async () => {
      const query = SELECT.from('draft.runtimeViews2.Book')
        .columns('title', 'HasDraftEntity')
        .where({ IsActiveEntity: true })
      
      const books = await tx.run(query)
      
      expect(books).toEqual(expect.arrayContaining([
        { title: 'Wuthering Heights', HasDraftEntity: false },
        { title: 'The Raven', HasDraftEntity: false },
        { title: 'Catweazle', HasDraftEntity: false },
        { title: 'Wikipedia', HasDraftEntity: false }
      ]))
    })
  })

  describe('Path Navigation', () => {
    
    test('testSelectFromPathToNonRuntimeView', async () => {
      const query = SELECT.distinct.from('runtimeViews0.Book')
        .columns('publisher { name }')
      
      const publishers = await tx.run(query)
      
      expect(publishers.map(p => p.publisher?.name)).toEqual(expect.arrayContaining(['Random House', 'Well-determined Tent']))
    })

    test('testSelectFromFilteredPathToNonRuntimeView', async () => {
      const query = SELECT.distinct.from('runtimeViews0.Book')
        .where({ 'publisher.ID': 'A' })
        .columns('publisher { name }')
      
      const publishers = await tx.run(query)
      
      expect(publishers).toHaveLength(1)
      expect(publishers[0].publisher.name).toBe('Random House')
    })

    test('testSelectFromPathDbViewToRuntimeView', async () => {
      const query = SELECT.distinct.from('views.BookToAuthorRTView')
        .columns('authorView { name }')
      
      const authors = await tx.run(query)
      
      expect(authors.map(a => a.authorView?.name)).toEqual(expect.arrayContaining(['Emil', 'Peter']))
    })

    test('testSelectFromFilteredPathDbViewToRuntimeView', async () => {
      const query = SELECT.from('views.BookToAuthorRTView')
        .where({ 'authorView.id': 1 })
        .columns('authorView { name }')
      
      const authors = await tx.run(query)
      
      expect(authors).toHaveLength(1)
      expect(authors[0].authorView.name).toBe('Peter')
    })
  })
})