const { createPool } = require('../../lib/common/generic-pool')

describe('Pool', () => {
  let pool
  let factory

  beforeEach(() => {
    factory = {
      create: jest.fn(() => Promise.resolve({})),
      destroy: jest.fn(() => Promise.resolve()),
      validate: jest.fn(() => Promise.resolve(true))
    }

    pool = createPool(factory, {
      min: 0,
      max: 4,
      acquireTimeoutMillis: 1000,
      idleTimeoutMillis: 30000,
      evictionRunIntervalMillis: 5000,
      testOnBorrow: true
    })
  })

  afterEach(async () => {
    await pool.clear()
    await pool.drain()
  })

  test('should acquire a resource from the pool', async () => {
    const resource = await pool.acquire()
    expect(resource).toBeDefined()
    expect(factory.create).toHaveBeenCalledTimes(1)
    expect(pool.borrowed).toBe(1)
    await pool.release(resource)
    expect(pool.borrowed).toBe(0)
  })

  test('should reuse an idle resource', async () => {
    const resource1 = await pool.acquire()
    await pool.release(resource1)
    const resource2 = await pool.acquire()
    expect(resource1).toBe(resource2)
    expect(factory.create).toHaveBeenCalledTimes(1)
    await pool.release(resource2)
  })

  test('should create new resources up to the max limit', async () => {
    const resources = await Promise.all([
      pool.acquire(),
      pool.acquire()
    ])
    expect(resources).toHaveLength(2)
    expect(factory.create).toHaveBeenCalledTimes(2)
    await Promise.all(resources.map(resource => pool.release(resource)))
  })

  test('should destroy and recreate invalid resources', async () => {
    factory.validate.mockResolvedValueOnce(false)
    const resource1 = await pool.acquire()
    expect(factory.destroy).toHaveBeenCalledTimes(1)
    await pool.release(resource1)
    const resource2 = await pool.acquire()
    expect(factory.validate).toHaveBeenCalledTimes(2)
    expect(pool.borrowed).toBeGreaterThan(0)
    await pool.release(resource2)
  })

  test('should drain the pool and reject new acquisitions', async () => {
    await pool.drain()
    await expect(pool.acquire()).rejects.toThrow('Pool is draining and cannot accept work')
  })

  test('should clear the pool', async () => {
    const resource = await pool.acquire()
    await pool.release(resource)
    await pool.clear()
    expect(factory.destroy).toHaveBeenCalledTimes(1)
    expect(pool.size).toBe(0)
  })

  test('should not create more resources than max limit', async () => {
    const resources = await Promise.all([
      pool.acquire(),
      pool.acquire(),
      pool.acquire(),
      pool.acquire(),
      pool.acquire().catch(e => e)  // This one should be rejected since max is 4
    ])
    expect(resources).toHaveLength(5)
    expect(factory.create).toHaveBeenCalledTimes(4)
    expect(resources[4]).toBeInstanceOf(Error)
    await Promise.all(resources.slice(0, 4).map(resource => pool.release(resource)))
  })

  test('should destroy a resource when released and marked as invalid', async () => {
    factory.validate.mockResolvedValueOnce(false)
    const resource = await pool.acquire()
    await pool.release(resource)
    expect(factory.destroy).toHaveBeenCalledTimes(1)
    expect(pool.size).toBe(0)
  })

  test('should handle concurrent acquisitions gracefully', async () => {
    const resources = await Promise.all([
      pool.acquire(),
      pool.acquire(),
      pool.acquire()
    ])
    expect(resources).toHaveLength(3)
    expect(factory.create).toHaveBeenCalledTimes(3)
    await Promise.all(resources.map(resource => pool.release(resource)))
  })
})
