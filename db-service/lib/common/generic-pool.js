const { createPool } = require('@sap/cds-foss').pool

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

module.exports = ConnectionPool
