const cds = require('@sap/cds')
const { expect } = cds.test

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const poolModule = require.resolve('../../lib/common/generic-pool')

async function expectRejected(promise, includes) {
  try {
    await promise
    expect.fail('Expected promise to reject')
  } catch (err) {
    if (includes) expect(err.message).to.include(includes)
  }
}

describe('built-in generic pool', () => {
  function createPool(overrides = {}) {
    const previous = cds.env.features.pool
    cds.env.features.pool = 'builtin'
    delete require.cache[poolModule]
    const ConnectionPool = require('../../lib/common/generic-pool')
    cds.env.features.pool = previous

    let id = 0
    const destroyed = []
    let validationCalls = 0
    const validateResults = overrides.validateResults || []
    const options = {
      min: 0,
      max: 2,
      evictionRunIntervalMillis: 0,
      ...overrides.options,
    }

    const factory = {
      options,
      create: async () => ({ id: ++id }),
      destroy: async dbc => {
        if (overrides.destroyDelay) await delay(overrides.destroyDelay)
        destroyed.push(dbc.id)
      },
      validate: async () => {
        const result = validateResults[validationCalls]
        validationCalls += 1
        return result == null ? true : result
      },
    }

    return {
      pool: new ConnectionPool(factory),
      destroyed,
      get created() { return id },
      get validationCalls() { return validationCalls },
    }
  }

  test('drain waits for borrowed connections before resolving', async () => {
    const { pool, destroyed } = createPool({ options: { max: 1 } })

    const dbc = await pool.acquire()
    let drained = false
    const draining = pool.drain().then(() => { drained = true })

    await delay(40)
    expect(drained).to.equal(false)

    await pool.release(dbc)
    await draining
    await pool.clear()

    expect(destroyed).to.eql([1])
  })

  test('drain is idempotent while in progress', async () => {
    const { pool } = createPool({ options: { max: 1 } })

    const dbc = await pool.acquire()
    let firstResolved = false
    let secondResolved = false
    const first = pool.drain().then(() => { firstResolved = true })
    const second = pool.drain().then(() => { secondResolved = true })

    await delay(20)
    expect(firstResolved).to.equal(false)
    expect(secondResolved).to.equal(false)

    await pool.release(dbc)
    await Promise.all([first, second])
    await pool.clear()
  })

  test('acquire rejects while pool is draining', async () => {
    const { pool } = createPool({ options: { max: 1 } })

    await pool.drain()
    await expectRejected(pool.acquire(), 'Pool is draining and cannot accept new requests')
    await pool.clear()
  })

  test('queued acquires are rejected when drain starts', async () => {
    const { pool } = createPool({ options: { max: 1 } })

    const dbc = await pool.acquire()
    const queued = pool.acquire()
    await delay(5)

    const draining = pool.drain()
    await expectRejected(queued, 'Pool is draining and cannot fulfil request')

    await pool.release(dbc)
    await draining
    await pool.clear()
  })

  test('drain resolves after destroy of borrowed connection', async () => {
    const { pool, destroyed } = createPool({ options: { max: 1 } })

    const dbc = await pool.acquire()
    let drained = false
    const draining = pool.drain().then(() => { drained = true })

    await delay(20)
    expect(drained).to.equal(false)

    await pool.destroy(dbc)
    await draining
    await pool.clear()

    expect(destroyed).to.eql([1])
  })

  test('clear destroys all resources after drain', async () => {
    const { pool, destroyed } = createPool({ options: { max: 2 } })

    const dbc1 = await pool.acquire()
    const dbc2 = await pool.acquire()
    await pool.release(dbc1)
    await pool.release(dbc2)

    await pool.drain()
    await pool.clear()

    expect(destroyed.sort((a, b) => a - b)).to.eql([1, 2])
  })

  test('pending acquires respect acquire timeout', async () => {
    const { pool } = createPool({ options: { max: 1, acquireTimeoutMillis: 20 } })

    const dbc = await pool.acquire()
    await expectRejected(pool.acquire(), 'Pool resource could not be acquired within')

    await pool.release(dbc)
    await pool.drain()
    await pool.clear()
  })

  test('testOnBorrow destroys invalid resource and retries', async () => {
    const stats = createPool({
      options: { max: 1, testOnBorrow: true },
      validateResults: [false, true],
    })
    const { pool, destroyed } = stats

    const dbc = await pool.acquire()
    expect(dbc.id).to.equal(2)
    expect(destroyed).to.eql([1])
    expect(stats.created).to.equal(2)
    expect(stats.validationCalls).to.equal(2)

    await pool.release(dbc)
    await pool.drain()
    await pool.clear()
  })
})
