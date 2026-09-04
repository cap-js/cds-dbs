const ConnectionPool = require('../../lib/common/generic-pool')

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
const expectTimeouts = async (pool, count) => {
  const results = await Promise.allSettled(Array.from({ length: count }, () => pool.acquire()))
  for (const result of results) {
    expect(result.status).toBe('rejected')
  }
}

describe('pool', () => {
  it('recovers availability after timed-out acquires', async () => {
    const pool = makePool({ max: 2, acquireTimeoutMillis: 50 })

    const a = await pool.acquire()
    const b = await pool.acquire()

    await expectTimeouts(pool, 3)

    await pool.release(a)
    await pool.release(b)

    expect(pool.available).toBe(2)
    expect(pool.borrowed).toBe(0)
    expect(pool.pending).toBe(0)
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
    expect(c.id).toBeGreaterThan(0)
    expect(d.id).toBeGreaterThan(0)
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

    expect(pool.size).toBe(1)
    await pool.release(conn)
    expect(pool.available).toBe(1)
  })

  it('discards a large number of timed-out acquires without exhausting the stack', async () => {
    const pool = makePool({ max: 1, acquireTimeoutMillis: 0 })
    const conn = await pool.acquire()

    await expectTimeouts(pool, 10_000)
    await pool.release(conn)

    expect(pool.pending).toBe(0)
    expect(pool.available).toBe(1)
  })
})
