let createPool
try {
  createPool = (await import('generic-pool')).createPool
} catch {
  createPool = function (factory, options) {
    return {
      queue: factory.create(),
      acquire() {
        const prom = {}
        prom.prom = new Promise((resolve, reject) => {
          prom.resolve = resolve
          prom.reject = reject
        })
        const ret = this.queue.then(dbc => { dbc._prom = prom; return dbc})
        this.queue = prom.prom
        return ret
      },
      release(dbc) {
        dbc._prom.resolve(dbc)
      },
    }
  }
}

class ConnectionPool {
  constructor(factory, tenant) {
    let bound_factory = { __proto__: factory, create: factory.create.bind(null, tenant) }
    return _track_connections4(createPool(bound_factory, factory.options))
  }
}

// REVISIT: Is that really neccessary ?!
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

export default ConnectionPool
