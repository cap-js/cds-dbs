const cds = require('../cds.js')

describe('DELETE', () => {
  const { data, expect } = cds.test(__dirname + '/resources')
  data.autoIsolation(true)
  data.autoReset()

  describe.skip('from', () => {
    test('ref', async () => {
      const { globals } = cds.entities('basic.projection')
      const changes = await cds.run(CQL`DELETE FROM ${globals}`)
      expect(changes | 0).to.eq(3, 'Ensure that all rows are affected')
    })
  })

  describe('where', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
})
