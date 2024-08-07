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
    this.promise = new Promise((resolve, reject) => {
      this._resolve = resolve
      this._reject = reject
      if (this._state !== 'pending') return
      this.removeTimeout()
      this._timeout = setTimeout(() => this.reject(new Error('ResourceRequest timed out')), ttl)
    })
  }

  removeTimeout() {
    if (this._timeout) {
      clearTimeout(this._timeout)
      this._timeout = null
    }
  }

  reject(reason) {
    if (this._state !== 'pending') return
    this.removeTimeout()
    this._state = 'rejected'
    this._reject(reason)
  }

  resolve(value) {
    if (this._state !== 'pending') return
    this.removeTimeout()
    this._state = 'fulfilled'
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
    this.start()
  }

  start() {
    this._scheduleEvictorRun()
    for (let i = 0; i < this.options.min - this.size; i++) this._createResource()
  }

  _createResource() {
    const _create = this.factory.create()
    this._creates.add(_create)
    _create.then(resource => {
        const pooledResource = new PooledResource(resource)
        this._all.add(pooledResource)
        pooledResource.updateState(ResourceState.IDLE)
        this._available.add(pooledResource)
      })
      .catch(reason => {
        this.emit('factoryCreateError', reason)
      })
      .finally(() => {
        this._creates.delete(_create)
        this._dispense()
      })
  }

  acquire() {
    if (this._draining) return Promise.reject(new Error('pool is draining and cannot accept work'))
    const resourceRequest = new ResourceRequest(this.options.acquireTimeoutMillis)
    this._queue.enqueue(resourceRequest)
    this._dispense()
    return resourceRequest.promise
  }

  _dispense() {
    const waiting = this._queue.length
    if (waiting < 1) return
    const shortfall = waiting - (this._available.size + this._creates.size)
    for (let i = 0; i < Math.min(this.options.max - this.size, shortfall); i++) this._createResource()
    const dispenseToNext = resource => {
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
    for (let i = 0; i < Math.min(this._available.size, waiting); i++) {
      if (this._available.size < 1) return false
      const resource = this._available.values().next().value
      this._available.delete(resource)
      if (this.options.testOnBorrow) {
        resource.updateState(ResourceState.VALIDATION)
        this.factory.validate(resource.obj)
          .then(isValid => {
            if (!isValid) {
              resource.updateState(ResourceState.INVALID)
              this._destroy(resource)
              this._dispense()
              return
            }
            dispenseToNext(resource)
          })
      } else {
        dispenseToNext(resource)
      }
    }
  }

  _destroy(resource) {
    resource.updateState(ResourceState.INVALID)
    this._all.delete(resource)
    const _destroy = this.factory.destroy(resource.obj)
    const wrapped = this.options.destroyTimeoutMillis ? Promise.race([
      new Promise((_, reject) => setTimeout(() => reject(new Error('destroy timed out')), this.options.destroyTimeoutMillis).unref()),
      _destroy
    ]) : _destroy
    wrapped.catch(reason => this.emit('factoryDestroyError', reason))
    if (this._draining) return
    for (let i = 0; i < this.options.min - this.size; i++) this._createResource()
  }

  _scheduleEvictorRun() {
    if (this.options.evictionRunIntervalMillis > 0) {
      this._scheduledEviction = setTimeout(() => {
        try {
          const evictionConfig = {
            softIdleTimeoutMillis: this.options.softIdleTimeoutMillis,
            idleTimeoutMillis: this.options.idleTimeoutMillis,
            min: this.options.min
          }
          const resourcesToEvict = Array.from(this._available)
            .slice(0, this.options.numTestsPerEvictionRun)
            .filter(resource => {
              const idleTime = Date.now() - resource.lastIdleTime
              const softEvict = evictionConfig.softIdleTimeoutMillis > 0 && evictionConfig.softIdleTimeoutMillis < idleTime && evictionConfig.min < this._available.size
              return softEvict || evictionConfig.idleTimeoutMillis < idleTime
            })
          resourcesToEvict.forEach(resource => {
            this._available.delete(resource)
            this._destroy(resource)
          })
        } catch (error) {
          this.emit('evictorRunError', error)
        } finally {
          this._scheduleEvictorRun()
        }
      }, this.options.evictionRunIntervalMillis).unref()
    }
  }

  release(resource) {
    const loan = this._loans.get(resource)
    if (!loan) return Promise.reject(new Error('Resource not currently part of this pool'))
    this._loans.delete(resource)
    const pooledResource = loan.pooledResource
    pooledResource.updateState(ResourceState.IDLE)
    this._available.add(pooledResource)
    this._dispense()
    return Promise.resolve()
  }

  destroy(resource) {
    const loan = this._loans.get(resource)
    if (!loan) return Promise.reject(new Error('Resource not currently part of this pool'))
    this._loans.delete(resource)
    const pooledResource = loan.pooledResource
    this._destroy(pooledResource)
    this._dispense()
    return Promise.resolve()
  }

  drain() {
    this._draining = true
    const allResourceRequestsSettled = this._queue.length > 0 ? this._queue.tail.promise : Promise.resolve()
    return allResourceRequestsSettled
      .then(() => Promise.all(Array.from(this._loans.values()).map(loan => loan.pooledResource.promise)))
      .then(() => clearTimeout(this._scheduledEviction))
  }

  async clear() {
    await Promise.all(Array.from(this._creates))
    for (const resource of this._available) this._destroy(resource)
  }

  get size() {
    return this._all.size + this._creates.size
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

module.exports = ConnectionPool
