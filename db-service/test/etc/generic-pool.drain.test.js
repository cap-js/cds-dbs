const cds = require('@sap/cds')
const { expect } = cds.test

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const poolModule = require.resolve('../../lib/common/generic-pool')

function builtinConnectionPool() {
  const previous = cds.env.features.pool
  cds.env.features.pool = 'builtin'
  delete require.cache[poolModule]
  const ConnectionPool = require('../../lib/common/generic-pool')
  cds.env.features.pool = previous
  return ConnectionPool
}

describe('connection pool drain', () => {
  async function expectDrainWaits(ConnectionPool) {

    let id = 0
    const destroyed = []
    const factory = {
      options: { min: 0, max: 1, evictionRunIntervalMillis: 0 },
      create: async () => ({ id: ++id }),
      destroy: async dbc => { destroyed.push(dbc.id) },
      validate: async () => true,
    }

    const pool = new ConnectionPool(factory)
    const dbc = await pool.acquire()

    let drained = false
    const draining = pool.drain().then(() => { drained = true })

    await delay(40)
    expect(drained).to.equal(false)

    await pool.release(dbc)
    await draining
    await pool.clear()

    expect(destroyed).to.eql([1])
  }

  test('waits for borrowed connections before drain resolves (built-in)', async () => {
    const ConnectionPool = builtinConnectionPool()
    await expectDrainWaits(ConnectionPool)
  })
})
