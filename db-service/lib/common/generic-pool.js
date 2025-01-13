const { createPool } = require('generic-pool')

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
module.exports = DEBUG ? TrackedConnectionPool : ConnectionPool
