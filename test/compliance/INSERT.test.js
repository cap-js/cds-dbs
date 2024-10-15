const cds = require('../cds')

describe('INSERT', () => {
  const { data, expect } = cds.test(__dirname + '/resources')
  data.autoIsolation(true)

  describe('into', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
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

  describe('default values', () => {
    test('default values are generated', async () => {
      const { 'basic.literals.defaults': entity } = cds.db.entities
      await cds.run(INSERT.into(entity).entries({ID: 1}))
      const result = await cds.run(SELECT.from(entity, 1))
      expect(result).to.deep.eq({ ID: 1, boolean: false, integer: 0, nulls: null, string: ''})
    })
  })
})
