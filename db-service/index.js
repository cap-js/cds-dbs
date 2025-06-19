import DatabaseService from './lib/common/DatabaseService.js'
import SQLService from './lib/SQLService.js'
import { classDefinition as CQN2SQL } from './lib/cqn2sql.js'

/**
 * @template T
 * @typedef {import('./lib/common/factory').Factory<T>} Factory
 */

/**
 * @typedef {import('./lib/SQLService').prototype.PreparedStatement} PreparedStatement
 */

export { DatabaseService, SQLService, CQN2SQL }
