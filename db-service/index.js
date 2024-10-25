const DatabaseService = require('./lib/common/DatabaseService')
const SQLService = require('./lib/SQLService')
const CQN2SQL = require('./lib/cqn2sql').classDefinition

/**
 * @template T
 * @typedef {import('./lib/common/factory').Factory<T>} Factory
 */

/**
 * @typedef {import('./lib/SQLService').prototype.PreparedStatement} PreparedStatement
 */

module.exports = {
  DatabaseService,
  SQLService,
  CQN2SQL,
}
