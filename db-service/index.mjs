import DatabaseServiceOrg from './lib/common/DatabaseService.mjs'
import SQLServiceOrg from './lib/SQLService.mjs'
import { classDefinition } from './lib/cqn2sql.mjs'

export const DatabaseService = DatabaseServiceOrg
export const SQLService = SQLServiceOrg
export const CQN2SQL = classDefinition

/**
 * @template T
 * @typedef {import('./lib/common/factory').Factory<T>} Factory
 */

/**
 * @typedef {import('./lib/SQLService.mjs').prototype.PreparedStatement} PreparedStatement
 */

export default {
  DatabaseService,
  SQLService,
  CQN2SQL,
}
