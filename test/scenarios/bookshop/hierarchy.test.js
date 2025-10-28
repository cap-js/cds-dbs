const cds = require('../../cds.js')
const bookshop = require('path').resolve(__dirname, '../../bookshop')

describe('Bookshop - Genres', () => {
  if (cds.version < '9') return test.todo('Tests are skipped until release of cds9')
  const { expect, GET, perf } = cds.test(bookshop)
  const { report } = perf || {}

  beforeAll(() => {
    cds.log('odata', 'error')
  })

  const topLevels = 'com.sap.vocabularies.Hierarchy.v1.TopLevels'

  test('TopLevels(1)', async () => {
    const res = await GET(`/tree/Genres?$select=DrillState,ID,name&$apply=${topLevels}(HierarchyNodes=$root/GenreHierarchy,HierarchyQualifier='GenreHierarchy',NodeProperty='ID',Levels=1)`)
    expect(res).property('data').property('value').deep.eq([
      {
        ID: 10,
        name: 'Fiction',
        DrillState: 'collapsed',
      },
      {
        ID: 20,
        name: 'Non-Fiction',
        DrillState: 'collapsed',
      },
    ])
  })

  test('TopLevels(null)', async () => {
    await GET(`/tree/Genres?$select=DrillState,ID,name&$apply=${topLevels}(HierarchyNodes=$root/GenreHierarchy,HierarchyQualifier='GenreHierarchy',NodeProperty='ID')`)
  })

  test('TopLevels with $expand', async () => {
    const query = `/tree/Genres?$select=DrillState,ID,name&$apply=${topLevels}(HierarchyNodes=$root/GenreHierarchy,HierarchyQualifier='GenreHierarchy',NodeProperty='ID',Levels=2)&$select=DrillState,ID,name&$expand=parent($select=ID,name)`
    const res = await GET(query)

    // should have parent expanded
    const hasParent = res.data.value.some(item => item.parent)
    expect(hasParent).to.be.true
  })

  test('ancestors($filter)/TopLevels(1)', async () => {
    const res = await GET(`/tree/Genres?$select=DrillState,ID,name&$apply=ancestors($root/GenreHierarchy,GenreHierarchy,ID,filter(tolower(name) eq tolower('Fantasy')),keep start)/${topLevels}(HierarchyNodes=$root/GenreHierarchy,HierarchyQualifier='GenreHierarchy',NodeProperty='ID',Levels=1)`)
    expect(res).property('data').property('value').deep.eq([
      {
        ID: 10,
        name: 'Fiction',
        DrillState: 'collapsed',
      },
    ])
  })

  test('LimitedRank calculation with ExpandLevels should be correct', async () => {
    const db = await cds.connect.to('db')    
    await db.run(INSERT.into('TreeService.RootComp').entries([
      { ID: 1, name: 'test root' },
    ]))

    await db.run(INSERT.into('sap.capire.bookshop.Genres').entries([
      { ID: 48, name: 'root 1', parent_ID: null, root_ID: 1 }, // LimitedRank 0
      { ID: 52, name: 'root 2', parent_ID: null, root_ID: 1 }, // LimitedRank 1
      { ID: 51, name: 'child 1', parent_ID: 52, root_ID: 1 }, // LimitedRank 2
      { ID: 50, name: 'child 2', parent_ID: 51, root_ID: 1 }, // LimitedRank 3
      { ID: 49, name: 'child 3', parent_ID: 50, root_ID: 1  }, // LimitedRank 4
      { ID: 53, name: 'root 3', parent_ID: null, root_ID: 1 }, // LimitedRank 5
    ]))

    const query = `/tree/RootComp(ID=1)/genres?$select=LimitedRank,name&$apply=${topLevels}(HierarchyNodes=$root/RootComp(ID=1)/genres,HierarchyQualifier='GenrestHierarchy',NodeProperty='ID',Levels=1,ExpandLevels=[{"NodeID":"52","Levels":1},{"NodeID":"51","Levels":1},{"NodeID":"50","Levels":1}])&$filter=ID eq 49`  
    const res = await GET(query)    
    expect(res).property('data').property('value').deep.eq([
      {
        ID: 49,
        LimitedRank: 4,
        name: 'child 3',
      },
    ])
  })

  test('ancestors($filter)/TopLevels(null)', async () => {
    await GET(`/tree/Genres?$select=DrillState,ID,name&$apply=ancestors($root/GenreHierarchy,GenreHierarchy,ID,filter(tolower(name) eq tolower('Fantasy')),keep start)/${topLevels}(HierarchyNodes=$root/GenreHierarchy,HierarchyQualifier='GenreHierarchy',NodeProperty='ID')`)
  })

  test.skip('perf', async () => {
    report(await perf.GET(`/tree/Genres`, { title: 'baseline' }))
    report(await perf.GET(`/tree/Genres?$select=DrillState,ID,name&$apply=${topLevels}(HierarchyNodes=$root/GenreHierarchy,HierarchyQualifier='GenreHierarchy',NodeProperty='ID',Levels=1)`, { title: 'TopLevels(1)' }))
    report(await perf.GET(`/tree/Genres?$select=DrillState,ID,name&$apply=${topLevels}(HierarchyNodes=$root/GenreHierarchy,HierarchyQualifier='GenreHierarchy',NodeProperty='ID')`, { title: 'TopLevels(null)' }))

    report(await perf.GET(`/tree/Genres?$select=DrillState,ID,name&$apply=ancestors($root/GenreHierarchy,GenreHierarchy,ID,filter(tolower(name) eq tolower('Fantasy')),keep start)/${topLevels}(HierarchyNodes=$root/GenreHierarchy,HierarchyQualifier='GenreHierarchy',NodeProperty='ID',Levels=1)`, { title: 'ancestors($filter)/TopLevels(1)' }))
    report(await perf.GET(`/tree/Genres?$select=DrillState,ID,name&$apply=ancestors($root/GenreHierarchy,GenreHierarchy,ID,filter(tolower(name) eq tolower('Fantasy')),keep start)/${topLevels}(HierarchyNodes=$root/GenreHierarchy,HierarchyQualifier='GenreHierarchy',NodeProperty='ID')`, { title: 'ancestors($filter)/TopLevels(null)' }))
  })
})
