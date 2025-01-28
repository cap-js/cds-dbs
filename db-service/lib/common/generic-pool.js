// Fork of/drop-in replacement for https://github.com/coopernurse/node-pool
// TODO: Test min > 0
// TODO: fifo: true? relevant for our use case?
// TODO: Queue from cds-mtxs for O(1) insert + delete + O(1) random access?
// TODO: Perf tests

const cds = require('@sap/cds')
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
    if (newState === ResourceState.IDLE) this.lastIdleTime = Date.now()
    this.state = newState
  }
}

const _vis = cds.requires.multitenancy?.diagnostics ? (name, ...body) => cds.emit(`pool:${name}`, ...body) : null

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
    _vis?.('acquire', { op: 'acquire', tenant: this.tenant, data: { pool: { request }}})
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
    const { database_id, tenant, schema } = resource._creds ?? {}
    _vis?.('release', { op: 'release', data: { pool: { database_id, tenant, schema }}})
    const loan = this._loans.get(resource)
    if (!loan) throw new Error('Resource not currently part of this pool')
    this._loans.delete(resource)
    const pooledResource = loan.pooledResource
    pooledResource.updateState(ResourceState.IDLE)
    this._available.add(pooledResource)
    this.#dispense()
    _vis?.('release:after', { op: 'release:after', data: { pool: { database_id, tenant, schema }}})
  }

  async destroy(resource) {
    const { database_id, tenant, schema } = resource._creds
    _vis?.('destroy', { op: 'destroy', data: { pool: { database_id, tenant, schema }}})
    const loan = this._loans.get(resource)
    if (!loan) throw new Error('Resource not currently part of this pool')
    this._loans.delete(resource)
    const pooledResource = loan.pooledResource
    await this.#destroy(pooledResource)
    this.#dispense()
    _vis?.('destroy:after', { op: 'destroy:after', data: { pool: { database_id, tenant, schema }}})
  }

  async drain() {
    _vis?.('drain', { op: 'drain', tenant: this.tenant })
    this._draining = true
    if (this._queue.length > 0) await this._queue[this._queue.length - 1].promise
    await Promise.all(Array.from(this._loans.values()).map(loan => loan.pooledResource.promise))
    clearTimeout(this._scheduledEviction)
    await Promise.all(Array.from(this._creates))
    await Promise.all(Array.from(this._available).map(resource => this.#destroy(resource)))
    _vis?.('drain:after', { op: 'drain:after', tenant:this.tenant })
  }

  async #createResource() {
    _vis?.('createResource', { op: 'createResource', tenant: this.tenant })
    try {
      const resource = await this.factory.create()
      const pooledResource = new PooledResource(resource)
      this._all.add(pooledResource)
      pooledResource.updateState(ResourceState.IDLE)
      this._available.add(pooledResource)
    } catch (error) {
      const request = this._queue.shift()
      request.reject(error)
    } finally {
      this.#dispense()
      _vis?.('createResource:after', { op: 'createResource:after', tenant: this.tenant })
    }
  }

  async #dispense() {
    _vis?.('dispense', { op: 'dispense', tenant: this.tenant })
    const waiting = this._queue.length
    if (waiting < 1) return
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
        resource.updateState(ResourceState.IDLE)
        this._available.add(resource)
        return false
      }
      if (request.state !== 'pending') {
        this.#dispense()
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
          try {
            const isValid = await this.factory.validate(resource.obj)
            if (!isValid) {
              resource.updateState(ResourceState.INVALID)
              await this.#destroy(resource)
            }
            return dispense(resource)
          } catch {
            resource.updateState(ResourceState.INVALID)
            await this.#destroy(resource)
            return false
          }
        })()
        _dispenses.push(validationPromise)
      } else {
        _dispenses.push(dispense(resource))
      }
    }
    await Promise.all(_dispenses)
    _vis?.('dispense:after', { op: 'dispense:after', tenant: this.tenant })
  }

  async #destroy(resource) {
    _vis?.('destroy-internal', { op: 'destroy-internal', tenant: this.tenant })
    resource.updateState(ResourceState.INVALID)
    this._all.delete(resource)
    this._available.delete(resource)
    this._loans.delete(resource.obj)
    try {
      await this.factory.destroy(resource.obj)
    } catch {
       /* FIXME: We have to ignore errors here due to a TypeError in hdb */
       /* This was also a problem with the generic-pool implementation */
    } finally {
      if (!this._draining && this.size < this.options.min) {
        await this.#createResource()
      }
    }
    _vis?.('destroy-internal:after', { op: 'destroy-internal:after', tenant: this.tenant, data: {pool: {resource}}})
  }

  #scheduleEviction() {
    _vis?.('scheduleEviction', { op: 'scheduleEviction', tenant: this.tenant })
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

const createPool = (factory, config) => {
  if (cds.requires.db.pool.new) return new Pool(factory, config)
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
