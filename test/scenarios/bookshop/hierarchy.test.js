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
