const { createPool } = require('../../lib/common/generic-pool')

const factory = {
  create: () => {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ id: Math.random().toString(36).substring(7) })
      }, 100)
    })
  },
  destroy: (resource) => {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve()
      }, 100)
    })
  },
  validate: (resource) => {
    return Promise.resolve(true)
  }
}

const poolConfig = {
  min: 0,
  max: 10,
  acquireTimeoutMillis: 1000,
  idleTimeoutMillis: 30000,
  evictionRunIntervalMillis: 5000,
  numTestsPerEvictionRun: 2,
  testOnBorrow: true
}

const pool = createPool(factory, poolConfig)

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

const visualizePoolState = (action) => {
  console.log(`\nPool State after ${action}:`)
  console.log(`  Total: ${pool.size}`)
  console.log(`  Available: ${pool.available}`)
  console.log(`  Borrowed: ${pool.borrowed}`)
  console.log(`  Pending: ${pool.pending}`)

  const available = '🟢'.repeat(pool.available)
  const borrowed = '🔴'.repeat(pool.borrowed)
  const pending = '🟡'.repeat(pool.pending)

  console.log(`  Resources: [${available}${borrowed}${pending}]`)
  console.log('-------------------------------')
}

const simulatePool = async () => {
  visualizePoolState('initialization')
  await delay(1000)

  const resources1 = await Promise.all([
    pool.acquire(),
    pool.acquire()
  ])
  visualizePoolState('acquiring 2 resources')
  await delay(1000)

  const resources2 = await Promise.all([
    pool.acquire(),
    pool.acquire()
  ])
  visualizePoolState('acquiring another 2 resources')
  await delay(1000)

  await Promise.all(resources1.map(resource => pool.release(resource)))
  visualizePoolState('releasing 2 resources')
  await delay(1000)

  const resourceToDestroy = await pool.acquire()
  visualizePoolState('acquiring 1 more resource for destruction')
  await delay(1000)

  await pool.destroy(resourceToDestroy)
  visualizePoolState('destroying 1 resource')
  await delay(1000)

  const additionalResources = await Promise.all([
    pool.acquire(),
    pool.acquire()
  ])
  visualizePoolState('acquiring 2 more resources')
  await delay(1000)

  await delay(6000)
  visualizePoolState('waiting for eviction')
  await delay(1000)

  console.log('Draining the pool...')
  await pool.drain()
  visualizePoolState('draining the pool')
  await delay(1000)
}

simulatePool().then(() => {
  console.log('Simulation completed')
}).catch(err => {
  console.error('Simulation error:', err)
})
