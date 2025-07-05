const cds = require('../cds.js')

describe('UPSERT', () => {
  const { expect } = cds.test(__dirname + '/resources')
  const uniques = {
    keys: { ID: 304110 },
    ASC: { ID: 304110 },
    Books: { ID: 304110 },
  }

  after(async () => {
    const { keys } = cds.entities('basic.common')
    const { ASC } = cds.entities('complex.keywords')
    const { Books } = cds.entities('complex.associations')

    await DELETE.from(keys).where(uniques.keys)
    await DELETE.from(ASC).where(uniques.ASC)
    await DELETE.from(Books).where(uniques.Books)
  })

  describe('into', () => {
    test('Apply default for keys before join to existing data', async () => {
      const { keys } = cds.entities('basic.common')

      // HXE cannot handle the default key logic when using @sap/hana-client
      await INSERT([{ ...uniques.keys, data: 'insert' }, { ...uniques.keys, default: 'overwritten', data: 'insert' }]).into(keys)
      const insert = await SELECT.from(keys)

      await UPSERT([{ ...uniques.keys, data: 'upsert' }, { ...uniques.keys, default: 'overwritten', data: 'upsert' }]).into(keys)
      const upsert = await SELECT.from(keys)

      for (let i = 0; i < insert.length; i++) {
        const ins = insert[i]
        const ups = upsert[i]
        expect(ups.ID).to.eq(ins.ID)
        expect(ups.default).to.eq(ins.default)
        expect(ins.data).to.eq('insert')
        expect(ups.data).to.eq('upsert')
      }
    })
  })

  describe('entries', () => {
    test('smart quoting', async () => {
      const { ASC } = cds.entities('complex.keywords')
      await UPSERT.into(ASC).entries({ ...uniques.ASC, select: 4711 })
      await UPSERT.into(ASC).entries({ ...uniques.ASC, alias: 9 })
      const select = await SELECT.one.from(ASC).where(`ID = ${uniques.ASC.ID}`)
      expect(select).to.eql({ ...uniques.ASC, select: 4711, alias: 9 })
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
          .rows([[uniques.ASC.ID, 4711]])
        let select = await SELECT.one.from(ASC, ['ID', 'select']).where(`ID = ${uniques.ASC.ID}`)
        expect(select).to.eql({ ...uniques.ASC, select: 4711 })
      })
    })
  })

  describe('as', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  test('affected row', async () => {
    const { Books } = cds.entities('complex.associations')
    const affectedRows = await UPSERT.into(Books).entries({ ...uniques.Books, title: 'Book' })
    expect(affectedRows).to.be.eq(1)
  })
})
