const cds = require('../cds.js')

/**
 * Tests explicitely, that all DBs access the specific client options
 */
describe('affected rows', () => {
  const { expect } = cds.test(__dirname + '/resources')

  test('client option is called during bootstrapping', async () => {
    let called = 0
    await cds.connect.to('db',
      Object.defineProperty(
        { ...cds.env.requires.db },
        'client',
        { get() { called++ } },
      )
    )

    expect(called).to.gt(0)
  })
})
