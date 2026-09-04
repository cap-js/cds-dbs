const ConnectionPool = require('../../lib/common/generic-pool')
const { mock } = require('node:test')
const cds = require('@sap/cds')
const { expect } = cds.test

let seq = 0
const makePool = (opts = {}) => {
  const factory = {
    options: { min: 0, max: 2, acquireTimeoutMillis: 50, ...opts },
    create:   async () => ({ id: ++seq }),
    destroy:  async () => {},
    validate: async () => true,
  }
  return new ConnectionPool(factory, null)
}

// Acquire `count` resources and assert they all time out. The pool rejects via an .unref()'d
// setTimeout, so we drive it with fake timers instead of waiting on the wall clock: this is
// deterministic, instant even for 10k requests, and avoids relying on real timers keeping the
// event loop alive (which node:test on Node 22 refuses to do -> "Promise resolution is still
// pending but the event loop has already resolved").
const expectTimeouts = async (pool, count) => {
  const acquires = Array.from({ length: count }, () => pool.acquire())
  mock.timers.tick((pool.options.acquireTimeoutMillis ?? 0) + 1)
  const results = await Promise.allSettled(acquires)
  for (const result of results) {
    expect(result.status).to.equal('rejected')
  }
}

describe('pool', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }))
  afterEach(() => mock.timers.reset())

  it('recovers availability after timed-out acquires', async () => {
    const pool = makePool({ max: 2, acquireTimeoutMillis: 50 })

    const a = await pool.acquire()
    const b = await pool.acquire()

    await expectTimeouts(pool, 3)

    await pool.release(a)
    await pool.release(b)

    expect(pool.available).to.equal(2)
    expect(pool.borrowed).to.equal(0)
    expect(pool.pending).to.equal(0)
  })

  it('acquires succeed after a timeout-then-release cycle', async () => {
    const pool = makePool({ max: 2, acquireTimeoutMillis: 50 })

    const a = await pool.acquire()
    const b = await pool.acquire()

    await expectTimeouts(pool, 2)

    await pool.release(a)
    await pool.release(b)

    const c = await pool.acquire()
    const d = await pool.acquire()
    expect(c.id).to.be.above(0)
    expect(d.id).to.be.above(0)
    await pool.release(c)
    await pool.release(d)
  })

  it('size stays stable across repeated timeout-and-release cycles', async () => {
    const pool = makePool({ max: 1, acquireTimeoutMillis: 50 })

    let conn = await pool.acquire()
    for (let i = 0; i < 5; i++) {
      await expectTimeouts(pool, 1)
      await pool.release(conn)
      conn = await pool.acquire()
    }

    expect(pool.size).to.equal(1)
    await pool.release(conn)
    expect(pool.available).to.equal(1)
  })

  it('discards a large number of timed-out acquires without exhausting the stack', async () => {
    const pool = makePool({ max: 1, acquireTimeoutMillis: 0 })
    const conn = await pool.acquire()

    await expectTimeouts(pool, 10_000)
    await pool.release(conn)

    expect(pool.pending).to.equal(0)
    expect(pool.available).to.equal(1)
  })
})
