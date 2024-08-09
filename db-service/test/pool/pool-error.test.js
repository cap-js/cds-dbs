const { createPool } = require('../../lib/common/generic-pool')

describe('Pool error handling', () => {
  let pool

  beforeEach(() => {
    const factory = {
      create: () => Promise.resolve({}),
      destroy: resource => Promise.resolve(),
      validate: resource => Promise.resolve(true)
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

  test('should propagate error when create method is rejected', async () => {
    const factory = {
      create: () => Promise.reject(new Error('Create failed')),
      destroy: () => Promise.resolve(),
      validate: () => Promise.resolve(true)
    }

    pool = createPool(factory, {
      min: 0,
      max: 4,
      acquireTimeoutMillis: 1000,
      idleTimeoutMillis: 30000,
      evictionRunIntervalMillis: 5000,
      testOnBorrow: true
    })

    await expect(pool.acquire()).rejects.toThrow('Create failed')
    expect(pool.size).toBe(0)
  })

  test('should propagate error when destroy method is rejected', async () => {
    const factory = {
      create: () => Promise.resolve({}),
      destroy: () => Promise.reject(new Error('Destroy failed')),
      validate: () => Promise.resolve(true)
    }

    pool = createPool(factory, {
      min: 0,
      max: 4,
      acquireTimeoutMillis: 1000,
      idleTimeoutMillis: 30000,
      evictionRunIntervalMillis: 5000,
      testOnBorrow: true
    })

    const resource = await pool.acquire()
    await expect(pool.destroy(resource)).rejects.toThrow('Destroy failed')
    expect(pool.size).toBe(0)
  })

  test('should propagate error when validate method is rejected', async () => {
    const factory = {
      create: () => Promise.resolve({}),
      destroy: () => Promise.resolve(),
      validate: () => Promise.reject(new Error('Validate failed'))
    }

    pool = createPool(factory, {
      min: 0,
      max: 4,
      acquireTimeoutMillis: 1000,
      idleTimeoutMillis: 30000,
      evictionRunIntervalMillis: 5000,
      testOnBorrow: true
    })

    const resource = await pool.acquire()
    await pool.release(resource)

    await expect(pool.acquire()).rejects.toThrow('Validate failed')
  })
})
