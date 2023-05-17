const cds = require('@sap/cds/lib')
const { expect } = cds.test

// eslint-disable-next-line no-global-assign
if (!cds.DatabaseService.prototype.isDatabaseService) describe = describe.skip

describe('Queries without models', () => {
  beforeAll(async () => {
    let db = await cds.connect.to('db', { kind: 'better-sqlite' })
    await db.run(['CREATE table T1 (a,b)', 'CREATE table T2 (c,d,e)'])
  })

  it(`should SELECT.from('sqlite.schema')`, async () => {
    const Schema = 'sqlite.schema'
    const entries = await SELECT.from(Schema)
    expect(entries).to.containSubset([
      { type: 'table', name: 'T1' },
      { type: 'table', name: 'T2' },
    ])
  })

  it(`should SELECT('type','name').from('sqlite.schema')`, async () => {
    const Schema = 'sqlite.schema'
    const entries = await SELECT('type', 'name').from(Schema)
    expect(entries).to.containSubset([
      { type: 'table', name: 'T1' },
      { type: 'table', name: 'T2' },
    ])
  })

  it(`should SELECT.from('sqlite.schema', e =>{...})`, async () => {
    const Schema = 'sqlite.schema'
    const entries = await SELECT.from(Schema, e => {
      e.type, e.name
    })
    expect(entries).to.containSubset([
      { type: 'table', name: 'T1' },
      { type: 'table', name: 'T2' },
    ])
  })

  it(`should SELECT.from('sqlite.schema').where({name:'T1'})`, async () => {
    const Schema = 'sqlite.schema'
    const entries = await SELECT.from(Schema).where({ name: 'T1' })
    expect(entries).to.containSubset([{ type: 'table', name: 'T1' }])
  })
})

describe('Queries not in models', () => {
  beforeAll(async () => {
    let model = cds.linked(`entity Foo { key ID : UUID; bar: String }`)
    let db = (cds.db = await cds.connect.to({ kind: 'better-sqlite', model }))
    await db.run(['CREATE table T1 (a,b)', 'CREATE table T2 (c,d,e)'])
  })

  it(`should SELECT.from('sqlite.schema')`, async () => {
    const Schema = 'sqlite.schema'
    const entries = await SELECT.from(Schema)
    expect(entries).to.containSubset([
      { type: 'table', name: 'T1' },
      { type: 'table', name: 'T2' },
    ])
  })

  it(`should SELECT.from('T1')`, async () => {
    await cds.run('INSERT into T1 values (1,2)')
    const entries = await SELECT.from('T1')
    expect(entries).to.deep.equal([{ a: 1, b: 2 }])
  })

  it(`should fail for SELECT.from('not_in_db')`, async () => {
    const q = SELECT.from('not_in_db')
    expect(q).to.be.rejectedWith('no such table')
  })
})
