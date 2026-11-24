const cds = require('../../../test/cds.js')

describe('hierarchy recurse with expand of an unmanaged association', () => {
  cds.test.in(__dirname)

  let db
  beforeAll(async () => {
    cds.env.requires.db = { kind: 'sqlite', credentials: { url: ':memory:' } }
    const model = cds.compile.to.csn(`
      entity Country { key ID : String; name : String; }
      entity NodeT { key ID : String; parentID : String; country_ID : String; name : String; }
      entity Node as select from NodeT mixin {
        parent  : Association to Node    on parent.ID  = $self.parentID;
        country : Association to Country on country.ID = $self.country_ID;
      } into { ID, parentID, country_ID, name,
        null as DrillState : String @Core.Computed,
        parent, country };
    `)
    db = await cds.connect.to('db')
    cds.model = cds.compile.for.nodejs(model)
    await cds.deploy(cds.model).to(db)
    await db.run(INSERT.into('Country').entries({ ID: 'DE', name: 'Germany' }))
    await db.run(INSERT.into('NodeT').entries(
      { ID: 'r', name: 'root' },
      { ID: 'c', parentID: 'r', country_ID: 'DE', name: 'child' }
    ))
  })

  test('expand of an unmanaged association does not need its foreign column selected', async () => {
    const q = SELECT.from('Node').columns('ID', 'name', 'DrillState', { ref: ['country'], expand: [{ ref: ['name'] }] })
    q.SELECT.recurse = { ref: ['parent'] }
    const res = await db.run(q)
    expect(res).toHaveLength(2)
    const child = res.find(r => r.ID === 'c')
    expect(child.country).toEqual({ name: 'Germany' })
    // the root has no country, so the expand has to be correlated per row
    expect(res.find(r => r.ID === 'r').country).toBeNull()
    // the column only needed for the ON condition does not show up in the result
    expect(Object.keys(child).sort()).toEqual(['DrillState', 'ID', 'country', 'name'])
  })
})
