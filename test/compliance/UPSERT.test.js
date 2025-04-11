const cds = require('../cds.js')

describe('UPSERT', () => {
  const { expect } = cds.test(__dirname + '/resources')

  describe('into', () => {
    test('Apply default for keys before join to existing data', async () => {
      const { keys } = cds.entities('basic.common')
      // HXE cannot handle the default key logic when using @sap/hana-client
      await INSERT([{ id: 0, data: 'insert' }, { id: 0, default: 'overwritten', data: 'insert' }]).into(keys)
      const insert = await SELECT.from(keys)

      await UPSERT([{ id: 0, data: 'upsert' }, { id: 0, default: 'overwritten', data: 'upsert' }]).into(keys)
      const upsert = await SELECT.from(keys)

      for (let i = 0; i < insert.length; i++) {
        const ins = insert[i]
        const ups = upsert[i]
        expect(ups.id).to.eq(ins.id)
        expect(ups.default).to.eq(ins.default)
        expect(ins.data).to.eq('insert')
        expect(ups.data).to.eq('upsert')
      }
    })
  })

  describe('entries', () => {
    test('smart quoting', async () => {
      const { ASC } = cds.entities('complex.keywords')
      await UPSERT.into(ASC).entries({ ID: 42, select: 4711 })
      await UPSERT.into(ASC).entries({ ID: 42, alias: 9 })
      const select = await SELECT.one.from(ASC).where('ID = 42')
      expect(select).to.eql({ ID: 42, select: 4711, alias: 9 })
    })
  })

  describe('columns', () => {
    describe('values', () => {
      test.skip('missing', () => {
        throw new Error('not supported')
      })
    })

    describe('rows', () => {
      test('smart quoting', async () => {
        const { ASC } = cds.entities('complex.keywords')
        await UPSERT.into(ASC)
          .columns(['ID', 'select'])
          .rows([[42, 4711]])
        let select = await SELECT.one.from(ASC, ['ID', 'select']).where('ID = 42')
        expect(select).to.eql({ ID: 42, select: 4711 })
      })
    })
  })

  describe('as', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  test('affected row', async () => {
    const affectedRows = await UPSERT.into('complex.associations.Books').entries({ ID: 9999999, title: 'Book' })
    expect(affectedRows).to.be.eq(1)
  })
})
