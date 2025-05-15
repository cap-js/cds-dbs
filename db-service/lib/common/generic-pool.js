const cds = require('@sap/cds')

const createPool = (factory, config) => {
  if (cds.requires.db?.pool?.builtin) return new Pool(factory, config)
  return require('generic-pool').createPool(factory, config)
}

function ConnectionPool (factory, tenant) {
  let bound_factory = { __proto__: factory, create: factory.create.bind(factory, tenant) }
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
module.exports = DEBUG ? TrackedConnectionPool : ConnectionPool

// Drop-in replacement for https://github.com/coopernurse/node-pool
// TODO: Test min > 0
// TODO: fifo: true? relevant for our use case?
// TODO: Queue from cds-mtxs for O(1) insert + delete + O(1) random access? Needs queue max size though.
// TODO: Perf tests

const { EventEmitter } = require('events')

const ResourceState = Object.freeze({
  ALLOCATED: 'ALLOCATED',
  IDLE: 'IDLE',
  INVALID: 'INVALID',
  VALIDATION: 'VALIDATION'
})

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

  constructor(factory, options = {}) {
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
    this._draining = false
    this._available = new Set()
    this._loans = new Map()
    this._all = new Set()
    this._creates = new Set()
    this._queue = []
    this.#scheduleEviction()
    for (let i = 0; i < this.options.min - this.size; i++) this.#createResource()
  }

  async acquire() {
    if (this._draining) throw new Error('Pool is draining and cannot accept work')
    const request = { state: 'pending' }
    request.promise = new Promise((resolve, reject) => {
      request.resolve = value => {
        clearTimeout(request.timeout)
        request.state = 'resolved'
        resolve(value)
      }
      request.reject = reason => {
        clearTimeout(request.timeout)
        request.state = 'rejected'
        reject(reason)
      }
      const ttl = this.options.acquireTimeoutMillis
      request.timeout = setTimeout(() => {
        request.reject(new Error(`ResourceRequest timed out after ${ttl/1000}s`))
      }, ttl)
    })
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
    if (this._queue.length > 0) await this._queue.at(-1).promise
    await Promise.all(Array.from(this._loans.values()).map(loan => loan.pooledResource.promise))
    clearTimeout(this._scheduledEviction)
  }

  async clear() {
    await Promise.all(Array.from(this._creates))
    await Promise.all(Array.from(this._available).map(resource => this.#destroy(resource)))
  }

  async #createResource() {
    try {
      const resource = new PooledResource(await this.factory.create())
      this._all.add(resource)
      this._available.add(resource)
    } catch (error) {
      const request = this._queue.shift()
      request?.reject(error)
    } finally {
      this.#dispense()
    }
  }

  async #dispense() {
    const waiting = this._queue.length
    if (waiting === 0) return
    const capacity = this._available.size + this._creates.size
    const shortfall = waiting - capacity
    if (shortfall > 0 && this.size < this.options.max) {
      const needed = Math.min(shortfall, this.options.max - this.size)
      for (let i = 0; i < needed; i++) {
        const _create = this.#createResource()
        this._creates.add(_create)
        _create.finally(() => {
          this._creates.delete(_create)
          this.#dispense()
        })
      }
    }
    const dispense = async resource => {
      const request = this._queue.shift()
      if (!request) {
        resource.idle()
        this._available.add(resource)
        return false
      }
      if (request.state !== 'pending') {
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
      await this.factory.destroy(resource.obj)
    } catch {
       /* FIXME: We have to ignore errors here due to a TypeError in hdb */
       /* This was also a problem with the old (generic-pool) implementation */
       /* Root cause in hdb needs to be fixed */
    } finally {
      if (!this._draining && this.size < this.options.min) {
        await this.#createResource()
      }
    }
  }

  #scheduleEviction() {
    const { evictionRunIntervalMillis, numTestsPerEvictionRun, softIdleTimeoutMillis, min, idleTimeoutMillis } = this.options
    if (evictionRunIntervalMillis <= 0) return
    this._scheduledEviction = setTimeout(async () => {
      try {
        const resourcesToEvict = Array.from(this._available)
          .slice(0, numTestsPerEvictionRun)
          .filter(resource => {
            const idleTime = Date.now() - resource.lastIdleTime
            const softEvict = softIdleTimeoutMillis > 0 && softIdleTimeoutMillis < idleTime && min < this._available.size
            return softEvict || idleTimeoutMillis < idleTime
          })
        await Promise.all(resourcesToEvict.map(resource => this.#destroy(resource)))
      } finally {
        this.#scheduleEviction()
      }
    }, evictionRunIntervalMillis).unref()
  }

  get size() {
    return this._all.size + this._creates.size
  }

  get available() {
    return this._available.size
  }

  get borrowed() {
    return this._loans.size
  }

  get tenant() {
    return this.options.tenant
  }

  get pending() {
    return this._queue.length
  }
}
