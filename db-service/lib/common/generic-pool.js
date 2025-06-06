const cds = require('@sap/cds')
const LOG = cds.log('db')

const use_new_pool = cds.requires.db?.pool?.builtin || cds.env.features.pool === 'builtin'
const createPool = use_new_pool ? (...args) => new Pool(...args) : require('generic-pool').createPool

function ConnectionPool (factory, tenant) {
  let bound_factory = { __proto__: factory, create: factory.create.bind(null, tenant) }
  return createPool(bound_factory, factory.options)
}

function TrackedConnectionPool (factory, tenant) {
  const pool = new ConnectionPool (factory, tenant)
  const { acquire, release } = pool
  return Object.assign(pool, {
    async acquire() {
      const connections = (this._trackedConnections ??= new Set())
      try {
        let dbc = await acquire.call(this)
        connections.add((dbc._beginStack = new Error('begin called from:')))
        return dbc
      } catch (err) {
        // TODO: add acquire timeout error check
        err.stack += `\nActive connections:${connections.size}\n${[...connections].map(e => e.stack).join('\n')}`
        throw err
      }
    },
    release(dbc) {
      this._trackedConnections?.delete(dbc._beginStack)
      return release.call(this, dbc)
    },
  })
}

const DEBUG = /\bpool\b/.test(process.env.DEBUG)
module.exports = DEBUG && !use_new_pool ? TrackedConnectionPool : ConnectionPool

// Drop-in replacement for https://github.com/coopernurse/node-pool
// TODO: fifo: true? relevant for our use case?

const { EventEmitter } = require('events')

const ResourceState = Object.freeze({
  ALLOCATED: 'allocated',
  IDLE: 'idle',
  INVALID: 'invalid',
  VALIDATION: 'validation'
})

const RequestState = Object.freeze({
  PENDING: 'pending',
  RESOLVED: 'resolved',
  REJECTED: 'rejected'
})

class Request {
  constructor (ttl) {
    this.state = RequestState.PENDING
    this.promise = new Promise((resolve, reject) => {
      this._resolve = value => {
        clearTimeout(this._timeout)
        this.state = RequestState.RESOLVED
        resolve(value)
      }
      this._reject = reason => {
        clearTimeout(this._timeout)
        this.state = RequestState.REJECTED
        reject(reason)
      }
      if (typeof ttl === 'number' && ttl >= 0) {
        const err = new Error(`Pool resource could not be acquired within ${ttl / 1000}s`)
        this._timeout = setTimeout(() => this._reject(err), ttl).unref()
      }
    })
  }
  resolve (v) { if (this.state === RequestState.PENDING) this._resolve(v) }
  reject (e) { if (this.state === RequestState.PENDING) this._reject(e) }
}

class PooledResource {
  constructor(resource) {
    this.obj = resource
    this.creationTime = Date.now()
    this.idle()
  }

  update(newState) {
    this.state = newState
  }
  idle() {
    this.state = ResourceState.IDLE
    this.lastIdleTime = Date.now()
  }
}

class Pool extends EventEmitter {

constructor (factory, options = {}) {
  super()
  this.factory = factory

  this.options = Object.assign({
    testOnBorrow: false,
    evictionRunIntervalMillis: 100000,
    numTestsPerEvictionRun: 3,
    softIdleTimeoutMillis: -1,
    idleTimeoutMillis: 30000,
    acquireTimeoutMillis: null,
    destroyTimeoutMillis: null,
    fifo: false,
    min: 0,
    max: 10
  }, options)

  /** @type {boolean} */
  this._draining = false

  /** @type {Set<PooledResource>} */
  this._available = new Set()

  /** @type {Map<any, { pooledResource: PooledResource }>} */
  this._loans = new Map()

  /** @type {Set<PooledResource>} */
  this._all = new Set()

  /** @type {Set<Promise<void>>} */
  this._creates = new Set()

  /** @type {Request[]} */
  this._queue = []

  this.#scheduleEviction()

  const initial = this.options.min - this.size
  for (let i = 0; i < initial; i++) this.#createResource()
}

  async acquire() {
    if (this._draining) throw new Error('Pool is draining and cannot accept new requests')
    const request = new Request(this.options.acquireTimeoutMillis)
    this._queue.push(request)
    this.#dispense()
    return request.promise
  }

  async release(resource) {
    const loan = this._loans.get(resource)
    if (!loan) throw new Error('Resource not currently part of this pool')
    this._loans.delete(resource)
    const pooledResource = loan.pooledResource
    pooledResource.idle()
    this._available.add(pooledResource)
    this.#dispense()
  }

  async destroy(resource) {
    const loan = this._loans.get(resource)
    if (!loan) throw new Error('Resource not currently part of this pool')
    this._loans.delete(resource)
    const pooledResource = loan.pooledResource
    await this.#destroy(pooledResource)
    this.#dispense()
  }

  async drain() {
    this._draining = true
    for (const request of this._queue.splice(0)) {
      if (request.state === RequestState.PENDING) request.reject(new Error('Pool is draining and cannot fulfil request'))
    }
    clearTimeout(this._scheduledEviction)
  }

  async clear() {
    await Promise.allSettled(Array.from(this._creates))
    await Promise.allSettled(Array.from(this._all).map(resource => this.#destroy(resource)))
  }

  async #createResource() {
    const createPromise = (async () => {
      try {
        const resource = new PooledResource(await this.factory.create())
        this._all.add(resource)
        this._available.add(resource)
      } catch (err) {
        this._queue.shift()?.reject(err)
      }
    })()
    this._creates.add(createPromise)
    createPromise.finally(() => {
      this._creates.delete(createPromise)
      this.#dispense()
    })
    return createPromise
  }

  async #dispense() {
    const waiting = this._queue.length
    if (waiting === 0) return
    const capacity = this._available.size + this._creates.size
    const shortfall = waiting - capacity
    if (shortfall > 0 && this.size < this.options.max) {
      const needed = Math.min(shortfall, this.options.max - this.size)
      for (let i = 0; i < needed; i++) this.#createResource()
    }
    const dispense = async resource => {
      const request = this._queue.shift()
      if (!request) {
        resource.idle()
        this._available.add(resource)
        return false
      }
      if (request.state !== RequestState.PENDING) {
        this.#dispense()
        return false
      }
      this._loans.set(resource.obj, { pooledResource: resource })
      resource.update(ResourceState.ALLOCATED)
      request.resolve(resource.obj)
      return true
    }

    const _dispenses = []
    for (let i = 0; i < Math.min(this._available.size, waiting); i++) {
      const resource = this._available.values().next().value
      this._available.delete(resource)
      if (this.options.testOnBorrow) {
        const validationPromise = (async () => {
          resource.update(ResourceState.VALIDATION)
          try {
            const isValid = await this.factory.validate(resource.obj)
            if (isValid) return dispense(resource)
          } catch {/* marked as invalid below */}
          resource.update(ResourceState.INVALID)
          await this.#destroy(resource)
          this.#dispense()
          return false
        })()
        _dispenses.push(validationPromise)
      } else {
        _dispenses.push(dispense(resource))
      }
    }
    await Promise.all(_dispenses)
  }

  async #destroy(resource) {
    resource.update(ResourceState.INVALID)
    this._all.delete(resource)
    this._available.delete(resource)
    this._loans.delete(resource.obj)
    try {
      const destroyPromise = Promise.resolve(this.factory.destroy(resource.obj))
      const { destroyTimeoutMillis } = this.options
      if (destroyTimeoutMillis && destroyTimeoutMillis > 0) {
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Resource destruction timed out after ${destroyTimeoutMillis}ms`)), destroyTimeoutMillis).unref()
        )
        await Promise.race([destroyPromise, timeout])
      } else {
        await destroyPromise
      }
    } catch (e) {
       LOG.error(e)
       /* FIXME: We have to ignore errors here due to a TypeError in hdb */
       /* This was also a problem with the old (generic-pool) implementation */
       /* Root cause in hdb needs to be fixed */
    } finally {
      if (!this._draining && this.size < this.options.min) this.#createResource()
    }
  }

  #scheduleEviction() {
    const { evictionRunIntervalMillis, numTestsPerEvictionRun, softIdleTimeoutMillis, min, idleTimeoutMillis } = this.options
    if (evictionRunIntervalMillis <= 0) return
    this._scheduledEviction = setTimeout(async () => {
      try {
        const evictionCandidates = Array.from(this._available).slice(0, numTestsPerEvictionRun)
        const destructionPromises = []
        for (const resource of evictionCandidates) {
          const idleTime = Date.now() - resource.lastIdleTime
          const softEvict = softIdleTimeoutMillis > 0 && softIdleTimeoutMillis < idleTime && this._all.size > min
          const hardEvict = idleTimeoutMillis < idleTime
          if (softEvict || hardEvict) {
            if (this._available.delete(resource)) {
              destructionPromises.push(this.#destroy(resource))
            }
          }
        }
        await Promise.all(destructionPromises)
      } finally {
        this.#scheduleEviction()
      }
    }, evictionRunIntervalMillis).unref()
  }

  get size()      { return this._all.size + this._creates.size }
  get available() { return this._available.size }
  get borrowed()  { return this._loans.size }
  get pending()   { return this._queue.length }
  get tenant()    { return this.options.tenant }
}
