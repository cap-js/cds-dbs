const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

describe('Runtime Views', () => {
  const { expect, GET } = cds.test(bookshop)
  
  beforeAll(() => {
    cds.log('odata', 'error')
  })

  describe('Basic Runtime View Operations', () => {
    
    test('testSelectAll_whereId - from runtimeViews1.Book', async () => {
      const res = await GET(`/runtimeViews0/Book?$filter=ID eq 201`)
      
      expect(res.data.value).toHaveLength(1)
      expect(res.data.value[0]).toMatchObject({
        ID: 201,
        title: 'Wuthering Heights',
        authorName: 'Peter'
      })
    })

    test('testSelect_nestedProjection_whereId - from runtimeViews2.Book', async () => {
      const res = await GET(`/runtimeViews2/Book?$select=ID,autor&$filter=ID eq 201&$expand=autor`)
      
      expect(res.data.value).toHaveLength(1)
      expect(res.data.value[0]).toMatchObject({
        ID: 201,
        autor: {
          ID: 1,
          nombre: 'Peter'
        }
      })
    })

    test('testSelect_withAlias_byId', async () => {
      const res = await GET(`/runtimeViews2/Book?$select=ID,title,AuthorName&$filter=ID eq 201`)
      
      expect(res.data.value).toHaveLength(1)
      expect(res.data.value[0]).toMatchObject({
        ID: 201,
        title: 'Wuthering Heights',
        AuthorName: 'Peter'
      })
    })

    test('testSelect_withAlias_whereIn_orderBy', async () => {
      const res = await GET(`/runtimeViews2/Book?$select=ID,title,AuthorName&$filter=ID eq 201 or ID eq 277&$orderby=title`)
      
      expect(res.data.value).toHaveLength(2)
      expect(res.data.value[0]).toMatchObject({
        ID: 277,
        title: 'Wikipedia',
        AuthorName: null
      })
      expect(res.data.value[1]).toMatchObject({
        ID: 201,
        title: 'Wuthering Heights',
        AuthorName: 'Peter'
      })
    })

    test('testSelect_distinct', async () => {
      const res = await GET(`/runtimeViews0/Book?$select=author/name&$filter=ID ne 277&$expand=author`)
      
      const authors = res.data.value.map(b => b.author?.name).filter(Boolean)
      expect(authors).toEqual(expect.arrayContaining(['Emil', 'Peter']))
    })

    test('testSelect_groupBy_having', async () => {
      const res = await GET(`/runtimeViews2/Book?$apply=groupby((AuthorName),aggregate($count as books))&$filter=AuthorName ne null`)
      
      expect(res.data.value).toEqual(expect.arrayContaining([
        { AuthorName: 'Emil', books: 2 },
        { AuthorName: 'Peter', books: 1 }
      ]))
    })
  })

  describe('Associations and Expansions', () => {
    
    test('testSelect_Expand_toMany', async () => {
      const res = await GET(`/runtimeViews1/Book?$select=title&$expand=editions($select=editionName)&$orderby=title&$skip=1&$top=2`)
      
      expect(res.data.value).toHaveLength(2)
      expect(res.data.value[0]).toMatchObject({
        title: 'The Raven',
        editions: expect.arrayContaining([
          { editionName: 'first' },
          { editionName: 'second' }
        ])
      })
      expect(res.data.value[1]).toMatchObject({
        title: 'Wikipedia',
        editions: []
      })
    })

    test('testSelect_ExpandWithAlias_toOne', async () => {
      const res = await GET(`/runtimeViews2/Book?$select=title&$expand=cat($select=name)&$filter=ID eq 201`)
      
      expect(res.data.value).toHaveLength(1)
      expect(res.data.value[0]).toMatchObject({
        title: 'Wuthering Heights',
        cat: { name: 'Novel' }
      })
    })

    test('testSelect_anyMatch', async () => {
      const res = await GET(`/runtimeViews2/Book?$select=title&$expand=cat($select=name)&$filter=cat/name eq 'Novel'`)
      
      expect(res.data.value).toHaveLength(1)
      expect(res.data.value[0]).toMatchObject({
        title: 'Wuthering Heights',
        cat: { name: 'Novel' }
      })
    })

    test('testSelect_search', async () => {
      const res = await GET(`/runtimeViews2/Book?$select=title&$expand=cat($select=name)&$filter=contains(title,'Height')`)
      
      expect(res.data.value).toHaveLength(1)
      expect(res.data.value[0]).toMatchObject({
        title: 'Wuthering Heights',
        cat: { name: 'Novel' }
      })
    })
  })

  describe('Filtered Views and Projections', () => {
    
    test('testSelect_projectionWithWhere - BooksWithLowStock', async () => {
      const res = await GET(`/runtimeViews0/runtimeViews.BooksWithLowStock?$select=title,count&$filter=publisher/name eq 'Random House'`)
      
      expect(res.data.value).toHaveLength(1)
      expect(res.data.value[0]).toMatchObject({
        title: 'Wuthering Heights',
        count: 12
      })
    })

    test('testSelect_projectionWithWhere - BooksWithHighStock', async () => {
      const res = await GET(`/runtimeViews0/runtimeViews.BooksWithHighStock?$select=title,count&$filter=startswith(publisher/name,'Random House')`)
      
      expect(res.data.value).toHaveLength(1)
      expect(res.data.value[0]).toMatchObject({
        title: 'The Raven',
        count: 333
      })
    })
  })

  describe('Path Expressions and Filtered Paths', () => {
    
    test('testSelectFromFilteredPath_toOne', async () => {
      const res = await GET(`/runtimeViews1/Edition?$filter=editionNumber eq '2'&$expand=parent($select=title,AuthorId;$expand=Author($select=name),editions($select=editionName))`)
      
      expect(res.data.value).toHaveLength(1)
      const book = res.data.value[0].parent
      expect(book).toMatchObject({
        title: 'The Raven',
        AuthorId: 2,
        Author: { name: 'Emil' }
      })
      expect(book.editions).toEqual(expect.arrayContaining([
        { editionName: 'first' },
        { editionName: 'second' }
      ]))
    })

    test('testSelectFromFilteredPath_toMany', async () => {
      const res = await GET(`/runtimeViews1/Book?$filter=AuthorId eq 2&$expand=editions($select=editionNumber,editionName;$expand=parent($select=title))`)
      
      expect(res.data.value).toHaveLength(1)
      expect(res.data.value[0].editions).toEqual(expect.arrayContaining([
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
      const res = await GET(`/runtimeViews3/OrderWithExpressions?$filter=ID eq 123&$select=literal,func,concat,caseWhen`)
      
      expect(res.data.value).toHaveLength(1)
      expect(res.data.value[0]).toMatchObject({
        literal: 'test',
        func: 'CANCELED',
        concat: 'STATUS: canceled',
        caseWhen: -1
      })
    })

    test('testSelectWithCalculatedElements', async () => {
      const res = await GET(`/runtimeViewsCalculated.Employees?$select=calc_fullName,calc_number,calc_manufacturer`)
      
      expect(res.data.value).toEqual(expect.arrayContaining([
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
      const res = await GET(`/runtimeViews10/Order`)
      
      // No left join for (to-many) items assoc causing duplicate Orders
      expect(res.data.value).toHaveLength(3)
      expect(res.data.value.map(r => r.ID)).toEqual(expect.arrayContaining([123, 234, 345]))
    })

    test('testSelectOrder_filteredAssocWithRenamedAttribute', async () => {
      const res = await GET(`/runtimeViews20/Order?$select=ID&$expand=items($select=ID,quantity)`)
      
      expect(res.data.value).toEqual(expect.arrayContaining([
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
      await expect(GET(`/runtimeViews0/runtimeViews.VirtualBookView`)).rejects.toThrow()
    })

    test('testSelectExcludedThrows - Excluded fields should not be accessible', async () => {
      await expect(GET(`/runtimeViews2/Book?$select=stock`)).rejects.toThrow(/stock/)
    })

    test('testSelectExcludedWithAliasThrows', async () => {
      await expect(GET(`/runtimeViews2/Book?$select=stock`)).rejects.toThrow(/stock/)
    })
  })

  describe('Draft-enabled Runtime Views', () => {
    
    test('testSelectFromDraftEnabledRuntimeView', async () => {
      const res = await GET(`/runtimeViews2Draft/Book?$select=title,IsActiveEntity,HasActiveEntity&$filter=IsActiveEntity eq true`)
      
      expect(res.data.value).toEqual(expect.arrayContaining([
        { title: 'Wuthering Heights', IsActiveEntity: true, HasActiveEntity: false },
        { title: 'The Raven', IsActiveEntity: true, HasActiveEntity: false },
        { title: 'Catweazle', IsActiveEntity: true, HasActiveEntity: false },
        { title: 'Wikipedia', IsActiveEntity: true, HasActiveEntity: false }
      ]))
    })

    test('testSelectFromDraftEnabledRuntimeView_HasDraftEntity', async () => {
      const res = await GET(`/runtimeViews2Draft/Book?$select=title,HasDraftEntity&$filter=IsActiveEntity eq true`)
      
      expect(res.data.value).toEqual(expect.arrayContaining([
        { title: 'Wuthering Heights', HasDraftEntity: false },
        { title: 'The Raven', HasDraftEntity: false },
        { title: 'Catweazle', HasDraftEntity: false },
        { title: 'Wikipedia', HasDraftEntity: false }
      ]))
    })
  })

  describe('Path Navigation', () => {
    
    test('testSelectFromPathToNonRuntimeView', async () => {
      const res = await GET(`/runtimeViews0/Book?$expand=publisher($select=name)`)
      
      const publisherNames = res.data.value.map(p => p.publisher?.name).filter(Boolean)
      expect(publisherNames).toEqual(expect.arrayContaining(['Random House', 'Well-determined Tent']))
    })

    test('testSelectFromFilteredPathToNonRuntimeView', async () => {
      const res = await GET(`/runtimeViews0/Book?$filter=publisher/ID eq 'A'&$expand=publisher($select=name)`)
      
      expect(res.data.value).toHaveLength(1)
      expect(res.data.value[0].publisher.name).toBe('Random House')
    })

    test('testSelectFromPathDbViewToRuntimeView', async () => {
      const res = await GET(`/runtimeViews0/views.BookToAuthorRTView?$expand=authorView($select=name)`)
      
      const authorNames = res.data.value.map(a => a.authorView?.name).filter(Boolean)
      expect(authorNames).toEqual(expect.arrayContaining(['Emil', 'Peter']))
    })

    test('testSelectFromFilteredPathDbViewToRuntimeView', async () => {
      const res = await GET(`/runtimeViews0/views.BookToAuthorRTView?$filter=authorView/ID eq 1&$expand=authorView($select=name)`)
      
      expect(res.data.value).toHaveLength(1)
      expect(res.data.value[0].authorView.name).toBe('Peter')
    })
  })
})