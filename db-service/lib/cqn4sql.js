'use strict'

const cds = require('@sap/cds')
const cloneCqn = require('./cqn4sql/clone')
const transformOwned = require('./cqn4sql/transform')
const { createState } = require('./cqn4sql/scope')
const { eqOps, notEqOps, notSupportedOps } = require('./cqn4sql/helpers')

/**
 * Transforms a CDL style query into SQL-Like CQN:
 *  - transform association paths in `from` to `WHERE exists` subqueries
 *  - transforms columns into their flat representation.
 *      1. Flatten managed associations to their foreign
 *      2. Flatten structures to their leafs
 *      3. Replace join-relevant ref paths (i.e. non-fk accesses in association paths) with the correct join alias
 *  - transforms `expand` columns into special, normalized subqueries
 *  - transform `where` clause.
 *      That is the flattening of all `ref`s and the expansion of `where exists` predicates
 *  - rewrites `from` clause:
 *      Each join relevant association path traversal is translated to a join condition.
 *
 * `cqn4sql` is applied recursively to all queries found in `from`, `columns` and `where`
 *  of a query.
 *
 * @param {object} originalQuery
 * @param {object} model
 * @returns {object} transformedQuery the transformed query
 */
function cqn4sql(originalQuery, model, useTechnicalAlias = true) {
  const query = typeof originalQuery === 'string' ? cds.parse.cql(originalQuery) : cloneCqn(originalQuery)
  return transformOwned(query, model, useTechnicalAlias, createState())
}

module.exports = Object.assign(cqn4sql, {
  // for own tests only:
  eqOps,
  notEqOps,
  notSupportedOps,
})
