const { createPool } = require('../../lib/common/generic-pool');

describe('Pool', () => {
  let pool;
  let factory;

  beforeEach(() => {
    factory = {
      create: jest.fn(() => Promise.resolve({})),
      destroy: jest.fn(() => Promise.resolve()),
      validate: jest.fn(() => Promise.resolve(true))
    };

    pool = createPool(factory, {
      min: 0,
      max: 4,
      acquireTimeoutMillis: 1000,
      idleTimeoutMillis: 30000,
      evictionRunIntervalMillis: 5000,
      testOnBorrow: true
    });
  });

  afterEach(async () => {
    await pool.clear();
    await pool.drain();
  });

  test('should acquire a resource from the pool', async () => {
    const resource = await pool.acquire();
    expect(resource).toBeDefined();
    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(pool.borrowed).toBe(1);
    await pool.release(resource);
    expect(pool.borrowed).toBe(0);
  });

  test('should reuse an idle resource', async () => {
    const resource1 = await pool.acquire();
    await pool.release(resource1);

    const resource2 = await pool.acquire();
    expect(resource1).toBe(resource2);
    expect(factory.create).toHaveBeenCalledTimes(1);
    await pool.release(resource2);
  });

  test('should create new resources up to the max limit', async () => {
    const resources = await Promise.all([
      pool.acquire(),
      pool.acquire(),
      pool.acquire(),
      pool.acquire()
    ])

    expect(resources).toHaveLength(4)
    expect(factory.create).toHaveBeenCalledTimes(4) // Now should be exactly 4

    await Promise.all(resources.map(resource => pool.release(resource)))
  })

  test('should time out when acquiring a resource if pool is full', async () => {
    const resources = await Promise.all([
      pool.acquire(),
      pool.acquire(),
      pool.acquire(),
      pool.acquire()
    ])

    await expect(pool.acquire()).rejects.toThrow('ResourceRequest timed out')

    await Promise.all(resources.map(resource => pool.release(resource)))
  })

  test('should destroy invalid resources', async () => {
    factory.validate.mockResolvedValueOnce(false)
    const resource1 = await pool.acquire()
    await pool.release(resource1)

    const resource2 = await pool.acquire()
    expect(factory.destroy).toHaveBeenCalledTimes(1)
    expect(resource1).not.toBe(resource2)

    await pool.release(resource2)
  })

  test('should drain the pool and reject new acquisitions', async () => {
    await pool.drain();
    await expect(pool.acquire()).rejects.toThrow('Pool is draining and cannot accept work');
  });

  test('should clear the pool', async () => {
    const resource = await pool.acquire();
    await pool.release(resource);
    await pool.clear();

    expect(factory.destroy).toHaveBeenCalledTimes(1);
    expect(pool.size).toBe(0);
  });
});
