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
    this.lastIdleTime = null
    this.state = ResourceState.IDLE
  }

  updateState(newState) {
    if (newState === ResourceState.IDLE) {
      this.lastIdleTime = Date.now()
    }
    this.state = newState
  }
}

class ResourceRequest {
  constructor(ttl) {
    this._state = 'pending'
    this._timeout = setTimeout(() => this.reject(new Error('ResourceRequest timed out')), ttl)
    this.promise = new Promise((resolve, reject) => {
      this._resolve = resolve
      this._reject = reject
    })
  }

  reject(reason) {
    clearTimeout(this._timeout)
    this._timeout = null
    this._reject(reason)
  }

  resolve(value) {
    clearTimeout(this._timeout)
    this._timeout = null
    this._resolve(value)
  }
}

class Queue {
  constructor() {
    this._queue = []
  }

  enqueue(request) {
    this._queue.push(request)
  }

  dequeue() {
    return this._queue.shift()
  }

  get length() {
    return this._queue.length
  }

  get tail() {
    return this._queue[this._queue.length - 1]
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
      min: 0,
      max: 10
    }, options)
    this._draining = false
    this._available = new Set()
    this._loans = new Map()
    this._all = new Set()
    this._creates = new Set()
    this._queue = new Queue()
    this.#scheduleEviction()
    for (let i = 0; i < this.options.min - this.size; i++) this.#createResource()
  }

  async acquire() {
    if (this._draining) throw new Error('Pool is draining and cannot accept work')
    const request = new ResourceRequest(this.options.acquireTimeoutMillis)
    this._queue.enqueue(request)
    await this.#dispense()
    return request.promise
  }

  async release(resource) {
    const loan = this._loans.get(resource)
    if (!loan) throw new Error('Resource not currently part of this pool')
    this._loans.delete(resource)
    const pooledResource = loan.pooledResource
    pooledResource.updateState(ResourceState.IDLE)
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
    if (this._queue.length > 0) await this._queue.tail.promise
    await Promise.all(Array.from(this._loans.values()).map(loan => loan.pooledResource.promise))
    clearTimeout(this._scheduledEviction)
  }

  async clear() {
    await Promise.all(Array.from(this._creates))
    await Promise.all(Array.from(this._available).map(resource => this.#destroy(resource)))
  }

  async #createResource() {
    try {
      const resource = await this.factory.create()
      const pooledResource = new PooledResource(resource)
      this._all.add(pooledResource)
      pooledResource.updateState(ResourceState.IDLE)
      this._available.add(pooledResource)
    } catch (reason) {
      const request = this._queue.dequeue()
      if (request) request.reject(reason)
    } finally {
      this._creates.delete(this.factory.create)
      this.#dispense()
    }
  }

  async #dispense() {
    const waiting = this._queue.length
    if (waiting < 1) return
    const capacity = this._available.size + this._creates.size
    if (capacity < waiting && this.size < this.options.max) {
      const _create = this.#createResource()
      this._creates.add(_create)
      await _create
      this._creates.delete(_create)
    }
    const dispense = async resource => {
      const request = this._queue.dequeue()
      if (!request) {
        resource.updateState(ResourceState.IDLE)
        this._available.add(resource)
        return false
      }
      this._loans.set(resource.obj, { pooledResource: resource })
      resource.updateState(ResourceState.ALLOCATED)
      request.resolve(resource.obj)
      return true
    }

    const _dispenses = []
    for (let i = 0; i < Math.min(this._available.size, waiting); i++) {
      const resource = this._available.values().next().value
      this._available.delete(resource)
      if (this.options.testOnBorrow) {
        const validationPromise = (async () => {
          resource.updateState(ResourceState.VALIDATION)
          const isValid = await this.factory.validate(resource.obj)
          if (!isValid) {
            resource.updateState(ResourceState.INVALID)
            await this.#destroy(resource)
          }
          return dispense(resource)
        })()
        _dispenses.push(validationPromise)
      } else {
        _dispenses.push(dispense(resource))
      }
    }
    await Promise.all(_dispenses)
  }

  async #destroy(resource) {
    resource.updateState(ResourceState.INVALID)
    this._all.delete(resource)
    this._available.delete(resource)
    this._loans.delete(resource.obj)
    try {
      await this.factory.destroy(resource.obj)
    } finally {
      if (!this._draining && this.size < this.options.min) {
        await this.#createResource()
      }
    }
  }

  #scheduleEviction() {
    const { evictionRunIntervalMillis, numTestsPerEvictionRun, softIdleTimeoutMillis, min, idleTimeoutMillis } = this.options
    if (evictionRunIntervalMillis > 0) {
      this._scheduledEviction = setTimeout(async () => {
        try {
          const resourcesToEvict = Array.from(this._available)
            .slice(0, numTestsPerEvictionRun)
            .filter(resource => {
              const idleTime = Date.now() - resource.lastIdleTime
              const softEvict = softIdleTimeoutMillis > 0 && softIdleTimeoutMillis < idleTime && min < this._available.size
              return softEvict || idleTimeoutMillis < idleTime
            })
          await Promise.all(resourcesToEvict.map(resource => {
            this._available.delete(resource)
            return this.#destroy(resource)
          }))
        } finally {
          this.#scheduleEviction()
        }
      }, evictionRunIntervalMillis).unref()
    }
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

  get pending() {
    return this._queue.length
  }
}

const createPool = (factory, config) => new Pool(factory, config)


class ConnectionPool {
  constructor(factory, tenant) {
    let bound_factory = { __proto__: factory, create: factory.create.bind(null, tenant) }
    return _track_connections4(createPool(bound_factory, factory.options))
  }
}

// REVISIT: Is that really necessary ?!
function _track_connections4(pool) {
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

module.exports = { ConnectionPool, createPool }
