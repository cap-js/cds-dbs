const cds = require('../../cds.js')
const bookshop = require('path').resolve(__dirname, '../../bookshop')

describe('Bookshop - Genres', () => {
  if (cds.version < '9') return test.todo('Tests are skipped until release of cds9')
  const { expect, GET, POST, perf } = cds.test(bookshop)
  const { report } = perf || {}

  beforeAll(async () => {
    cds.log('odata', 'error')
  })

  const topLevels = 'com.sap.vocabularies.Hierarchy.v1.TopLevels'

  test('TopLevels(1)', async () => {
    const res = await GET(`/tree/Genres?$select=DrillState,ID,name&$apply=${topLevels}(HierarchyNodes=$root/GenreHierarchy,HierarchyQualifier='GenreHierarchy',NodeProperty='ID',Levels=1)&$filter=ID eq 10 or ID eq 20`)
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

  test('Path expression to hierarchy with multiple in draft $expand', async () => {
    await POST`/tree/Books(ID=201,IsActiveEntity=true)/draftEdit${{}}`
    const query = `/tree/Books(ID=201,IsActiveEntity=false)/genre?$select=DrillState,ID,name&$apply=${topLevels}(HierarchyNodes=$root/GenreHierarchy,HierarchyQualifier='GenreHierarchy',NodeProperty='ID',Levels=2)&$select=DrillState,ID,name&$expand=parent($select=ID,name),children`
    const res = await GET(query)

    // should have parent expanded
    const hasParent = redata.value.some(item => item.parent)
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

  test('LimitedRank via composition and filter', async () => {
    const query = `/tree/Root(ID=1)/genres?$select=LimitedRank,name&$apply=${topLevels}(HierarchyNodes=$root/Root(ID=1)/genres,HierarchyQualifier='GenresComptHierarchy',NodeProperty='ID',Levels=1,ExpandLevels=[{"NodeID":"52","Levels":1},{"NodeID":"51","Levels":1},{"NodeID":"50","Levels":1}])&$filter=ID eq 49`
    const res = await GET(query)
    expect(res).property('data').property('value').deep.eq([
      {
        ID: 49,
        LimitedRank: 5,
        name: 'Arthurian Legend',
      }
    ])
  })

  test('ancestors($filter)/TopLevels(null)', async () => {
    await GET(`/tree/Genres?$select=DrillState,ID,name&$apply=ancestors($root/GenreHierarchy,GenreHierarchy,ID,filter(tolower(name) eq tolower('Fantasy')),keep start)/${topLevels}(HierarchyNodes=$root/GenreHierarchy,HierarchyQualifier='GenreHierarchy',NodeProperty='ID')`)
  })

  test('Hierarchy query with projection alias should handle NODE_ID column conflicts', async () => {
    const query = `/tree/GenresWithNodeIdAlias?$select=name,node_id&$apply=${topLevels}(HierarchyNodes=$root/GenresWithNodeIdAlias,HierarchyQualifier='GenresWithNodeIdAliasHierarchy',NodeProperty='ID',Levels=1)&$filter=ID eq 10 or ID eq 20`
    const res = await GET(query)
    expect(res).property('data').property('value').deep.eq([
      {
        ID: 10,
        name: 'Fiction',
        node_id: 10
      },
      {
        ID: 20,
        name: 'Non-Fiction',
        node_id: 20
      }
    ])
  })

  test('Hierarchy query with null as node_id alias', async () => {
    const query = `/tree/GenresAliases?$select=name,node_id&$apply=${topLevels}(HierarchyNodes=$root/GenresAliases,HierarchyQualifier='GenresAliases',NodeProperty='ID',Levels=1)&$filter=ID eq 10 or ID eq 20`
    const res = await GET(query)
    expect(res).property('data').property('value').deep.eq([
      {
        ID: 10,
        name: 'Fiction',
        node_id: null
      },
      {
        ID: 20,
        name: 'Non-Fiction',
        node_id: null
      }
    ])
  })

  test.skip('perf', async () => {
    report(await perf.GET(`/tree/Genres`, { title: 'baseline' }))
    report(await perf.GET(`/tree/Genres?$select=DrillState,ID,name&$apply=${topLevels}(HierarchyNodes=$root/GenreHierarchy,HierarchyQualifier='GenreHierarchy',NodeProperty='ID',Levels=1)`, { title: 'TopLevels(1)' }))
    report(await perf.GET(`/tree/Genres?$select=DrillState,ID,name&$apply=${topLevels}(HierarchyNodes=$root/GenreHierarchy,HierarchyQualifier='GenreHierarchy',NodeProperty='ID')`, { title: 'TopLevels(null)' }))

    report(await perf.GET(`/tree/Genres?$select=DrillState,ID,name&$apply=ancestors($root/GenreHierarchy,GenreHierarchy,ID,filter(tolower(name) eq tolower('Fantasy')),keep start)/${topLevels}(HierarchyNodes=$root/GenreHierarchy,HierarchyQualifier='GenreHierarchy',NodeProperty='ID',Levels=1)`, { title: 'ancestors($filter)/TopLevels(1)' }))
    report(await perf.GET(`/tree/Genres?$select=DrillState,ID,name&$apply=ancestors($root/GenreHierarchy,GenreHierarchy,ID,filter(tolower(name) eq tolower('Fantasy')),keep start)/${topLevels}(HierarchyNodes=$root/GenreHierarchy,HierarchyQualifier='GenreHierarchy',NodeProperty='ID')`, { title: 'ancestors($filter)/TopLevels(null)' }))
  })
})
