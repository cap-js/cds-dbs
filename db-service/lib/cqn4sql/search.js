'use strict'

module.exports = { transformSearch, getSearch, buildSearchRankOrderBy, correlateSearchRank }

const cds = require('@sap/cds')
const { computeColumnsToBeSearched } = require('../search')
const { defineProperty } = require('../utils')
const { asXpr, getPrimaryKey } = require('./helpers')

/**
 * Transforms a search expression into a WHERE or HAVING clause for a SELECT operation, depending on the context of the query.
 * The function decides whether to use a WHERE or HAVING clause based on the presence of aggregated columns in the search criteria.
 *
 * @param {object} searchTerm - The search expression to be applied to the searchable columns within the query source.
 * @param {object} from - The FROM clause of the CQN statement.
 *
 * @returns {Object} - The function returns an object representing the WHERE or HAVING clause of the query.
 *
 * Note: The WHERE clause is used for filtering individual rows before any aggregation occurs.
 * The HAVING clause is utilized for conditions on aggregated data, applied after grouping operations.
 */
function transformSearch(ctx, searchTerm) {
  let prop = 'where'

  // if the query is grouped and the queries columns contain an aggregate function,
  // we must put the search term into the `having` clause, as the search expression
  // is defined on the aggregated result, not on the individual rows
  const usesAggregation =
    ctx.query.SELECT.groupBy &&
    (searchTerm.args[0].func || searchTerm.args[0].xpr || searchTerm.args[0].list?.some(c => c.func || c.xpr))

  if (usesAggregation) prop = 'having'
  if (ctx.query.SELECT[prop]) {
    return { [prop]: [asXpr(ctx.query.SELECT.where), 'and', searchTerm] }
  } else {
    return { [prop]: searchTerm.xpr ? [...searchTerm.xpr] : [searchTerm] }
  }
}

/**
 * For a given search term calculate a search expression which can be used in a where clause.
 * The search function is pushed to a subquery and the primary key(s) of the entity is/are used to match
 * the search results of the subquery.
 *
 * @param {object} searchTerm - The search expression which shall be applied to the searchable columns on the query source.
 * @param {object} query - The FROM clause of the CQN statement.
 *
 * @returns {(Object|null)} returns either:
 * - an expression of the form `<primaryKey> in (select <primaryKey> from <entity> where search(<searchableColumns>, <searchTerm>))`
 * - a function with two arguments: The first one being the list of searchable columns, the second argument holds the search expression.
 * - or null, if no searchable columns are found in neither in `@cds.search` nor in the target entity itself.
 */
function getSearch(ctx, searchTerm, query) {
  const entity = query.SELECT.from.SELECT ? query.SELECT.from : cds.infer.target(query, ctx.model)
  const searchIn = computeColumnsToBeSearched(ctx.query, entity)
  if (searchIn.length === 0) return null

  const searchFunc = {
    func: 'search',
    args: [
      searchIn.length === 1 ? searchIn[0] : { list: searchIn },
      searchTerm.length === 1 && 'val' in searchTerm[0] ? searchTerm[0] : { xpr: searchTerm },
    ],
  }
  // for aggregated queries / search on subqueries we do not do a subquery search
  if (ctx.query.SELECT.groupBy || entity.SELECT) return searchFunc

  const matchColumns = getPrimaryKey(entity)
  if (matchColumns.length === 0 || searchIn.every(r => r.ref.length === 1))
    // keyless or not deep, fallback to old behavior
    return searchFunc

  const subquery = SELECT.from(entity)
    .columns(...matchColumns)
    .where(searchFunc)
  return { xpr: [matchColumns.length === 1 ? matchColumns[0] : { list: matchColumns }, 'in', subquery] }
}

/**
 * Builds the ORDER BY entry ranking rows by $search relevance, sorted desc.
 *
 * Flat search: the score is on the outer row.
 * Deep search: the score lives in a semi-join, so emit a correlated scalar sub-select
 *   (SELECT search(…, true) FROM <same source> WHERE innerKey = <outerAlias>.key) DESC.
 * Key comparisons are seeded unqualified (infer() binds them to the sub-select's own source);
 * correlateSearchRank redirects the rhs to the outer alias afterwards.
 *
 * @param {object} searchTerm the search term as returned by getSearch (func or xpr shape)
 * @returns {object|null} an orderBy entry, or null if there is nothing to rank by
 */
function buildSearchRankOrderBy(ctx, searchTerm) {
  if (searchTerm.func) return { func: searchTerm.func, args: [...searchTerm.args, { val: true }], sort: 'desc' }
  if (!searchTerm.xpr) return null

  const searchSelect = searchTerm.xpr[2]
  const searchFunc = searchSelect.SELECT.where[0]
  const innerKeys = searchSelect.SELECT.columns // unqualified pk refs, e.g. [{ ref: ['ID'] }]

  const where = []
  for (let i = 0; i < innerKeys.length; i++) {
    if (i) where.push('and')
    // seeded unqualified on both sides; correlateSearchRank redirects the rhs to the outer row
    where.push({ ref: [...innerKeys[i].ref] }, '=', { ref: [...innerKeys[i].ref] })
  }

  const entry = {
    __proto__: SELECT.from(searchSelect.SELECT.from)
      // the correlated outer row fans out to many child rows -> MAX makes it a single score
      .columns({ func: 'max', args: [{ func: searchFunc.func, args: [...searchFunc.args, { val: true }] }] })
      .where(where),
    sort: 'desc',
  }
  defineProperty(entry, '$searchRank', true)
  return entry
}

/**
 * Correlates the (transformed) deep-search ranking sub-select to the outer row.
 *
 * buildSearchRankOrderBy seeds its WHERE as `ref = ref` comparisons on the sub-select's own
 * alias; this rewrites each rhs to `<outerAlias>.<key>`. Driven off the `=` operator (not a
 * fixed stride) so it holds for any key count.
 *
 * @param {object} entry the transformed orderBy entry produced from a `$searchRank` sub-select
 * @param {string} outerAlias the final table alias of the outer query source
 */
function correlateSearchRank(ctx, entry, outerAlias) {
  const where = entry.SELECT.where
  for (let i = 1; i < where.length; i++) {
    // seeded comparisons are exactly `<ref> = <ref>`; rewrite the rhs ref to the outer row
    if (where[i] === '=' && where[i - 1]?.ref && where[i + 1]?.ref) {
      const rhs = where[i + 1]
      rhs.ref = [outerAlias, ...rhs.ref.slice(1)]
    }
  }
}
