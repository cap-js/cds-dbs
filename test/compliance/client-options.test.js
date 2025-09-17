const assert = require('assert')
const cds = require('../cds.js')
cds.test.in(__dirname + '/resources')

const clientOption = cds.env.requires.db.client
let called = 0
Object.defineProperty(cds.env.requires.db, 'client', {
  get: () => {
    called++
    return clientOption
  }
})
/**
 * Tests explicitely, that all DBs access the specific client options
 */
describe('affected rows', () => {
  cds.test()

  test('client option is called during bootstrapping', async () => {
    assert.strictEqual(called >= 1,true)
  })
})
