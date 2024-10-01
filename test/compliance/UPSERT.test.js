const cds = require('../cds.js')

describe('UPSERT', () => {
  const { data, expect } = cds.test(__dirname + '/resources')
  data.autoIsolation(true)

  describe('into', () => {
    test('Apply default for keys before join to existing data', async () => {
      const { keys } = cds.entities('basic.common')
      // HXE cannot handle the default key logic
      await INSERT([/*{ id: 0, data: 'insert' },*/ { id: 0, default: 'overwritten', data: 'insert' }]).into(keys)
      const insert = await SELECT.from(keys)

      await UPSERT([/*{ id: 0, data: 'upsert' },*/ { id: 0, default: 'overwritten', data: 'upsert' }]).into(keys)
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
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  describe('columns', () => {
    describe('values', () => {
      test.skip('missing', () => {
        throw new Error('not supported')
      })
    })

    describe('rows', () => {
      test.skip('missing', () => {
        throw new Error('not supported')
      })
    })
  })

  describe('as', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
})
