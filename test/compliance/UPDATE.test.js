const cds = require('../cds.js')

describe('UPDATE', () => {
  const { expect, data } = cds.test(__dirname + '/resources')
  data.autoIsolation(true)

  describe('entity', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  describe('data', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  describe('where', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  describe('deep update', () => {
    test('huge deep update does not cause sql exception', async () => {
      // sqlite limit of placeholders is 32766 -> 9. of https://www.sqlite.org/limits.html
      await INSERT.into('compositions.Travel').entries({
        ID: 4711,
        bookings: (new Array(33000).fill(0).map((_, i) => ({ ID: i})))
      })

      // deep update that has to read all entries
      const result = await UPDATE('compositions.Travel[ID=4711]').set({ bookings: [{ID: 1, name: 'foo' }]})
      expect(result).not.to.be.undefined
    })
  })
})
