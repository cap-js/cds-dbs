'use strict'

module.exports = {
  transformSelectQuery,
  refersToLocalizedElement,
  transformQueryForInsertUpsert,
  getTransformedOrderByGroupBy,
}

const columnsModule = require('./columns')
const flattenModule = require('./flatten')
const expressionsModule = require('./expressions')
const searchModule = require('./search')
const sourcesModule = require('./sources')

const cds = require('@sap/cds')
const { pseudos } = require('./pseudos')
const { isCalculatedOnRead, defineProperty, hasOwnSkip, isRuntimeView } = require('../utils')
const { getFullName, idOnly } = require('./helpers')

function transformSelectQuery(ctx, queryProp, transformedFrom, transformedWhere, transformedQuery) {
  const { columns, having, groupBy, orderBy, limit } = queryProp

  // Trivial replacement -> no transformations needed
  if (limit) {
    transformedQuery.SELECT.limit = limit
  }

  transformedQuery.SELECT.from = transformedFrom

  if (transformedWhere?.length > 0) {
    transformedQuery.SELECT.where = transformedWhere
  }

  if (columns) {
    transformedQuery.SELECT.columns = columnsModule.getTransformedColumns(ctx, columns)
  } else {
    transformedQuery.SELECT.columns = flattenModule.getColumnsForWildcard(ctx, ctx.query.SELECT?.excluding)
  }

  // Like the WHERE clause, aliases from the SELECT list are not accessible for `group by`/`having` (in most DB's)
  if (having) {
    transformedQuery.SELECT.having = expressionsModule.getTransformedTokenStream(ctx, having, { prop: 'having' })
  }

  if (groupBy) {
    const transformedGroupBy = getTransformedOrderByGroupBy(ctx, groupBy)
    if (transformedGroupBy.length) {
      transformedQuery.SELECT.groupBy = transformedGroupBy
    }
  }

  // flag queries whose count depends on the localized view
  if (ctx.query.SELECT.localized && refersToLocalizedElement(ctx, [having, groupBy, ctx.query.SELECT.where])) {
    defineProperty(transformedQuery.SELECT, 'localizedCountRelevant', true)
  }

  // Since all the expressions in the SELECT part of the query have been computed,
  // one can reference aliases of the queries columns in the orderBy clause.
  let effectiveOrderBy = orderBy
  // Rank by $search relevance — only when the score exists (HANA fuzzy, not opted out); else
  // it would sort by a constant boolean.
  const ranksSearch =
    cds.db?.kind === 'hana' && cds.env.hana?.fuzzy !== false && cds.env.hana?.fuzzy?.ranked_search !== false
  // count queries or static values do not need ranked search
  const isCountQuery =
    columns?.length === 1 && typeof columns[0] === 'object' && (columns[0].func === 'count' || 'val' in columns[0])
  // a user-provided ORDER BY takes precedence over the search rank — don't inject the ranking then
  const hasExplicitOrderBy = (orderBy || []).some(o => !o.implicit)
  const searchRank =
    ranksSearch &&
    !isCountQuery &&
    !hasExplicitOrderBy &&
    ctx.query.$searchRank &&
    searchModule.buildSearchRankOrderBy(ctx, ctx.query.$searchRank)
  if (searchRank) {
    // precedence: user ordering, then rank, then the runtime's implicit key ordering
    const implicitAt = (orderBy || []).findIndex(o => o.implicit)
    const at = implicitAt === -1 ? (orderBy?.length ?? 0) : implicitAt
    effectiveOrderBy = [...(orderBy || [])]
    effectiveOrderBy.splice(at, 0, searchRank)
  }
  if (effectiveOrderBy) {
    const transformedOrderBy = getTransformedOrderByGroupBy(ctx, effectiveOrderBy, true)
    if (transformedOrderBy.length) {
      // the rank is the only order-by entry that is a correlated sub-select
      if (searchRank?.$searchRank) {
        const rank = transformedOrderBy.find(o => o.SELECT)
        if (rank) searchModule.correlateSearchRank(ctx, rank, transformedFrom.as)
      }
      transformedQuery.SELECT.orderBy = transformedOrderBy
    }
  }
  return transformedQuery
}

/**
 * True if any token in the given clauses filters or groups on a localized element — a value
 * that differs between base table and localized view, so a count on the base table is wrong.
 */
function refersToLocalizedElement(ctx, tokenStreams) {
  const scan = tokens => {
    if (!tokens) return false
    return tokens.some(t => {
      if (t?.ref) {
        const leaf = t.$refLinks?.[t.$refLinks.length - 1]
        if (leaf?.definition?.localized && ctx.isLocalized(leaf.target)) return true
        // path-filter infixes may carry their own refs (e.g. `assoc[title = 'x']`)
        if (t.ref.some(step => typeof step === 'object' && step.where && scan(step.where))) return true
      }
      if (t?.xpr) return scan(t.xpr)
      if (t?.args) return scan(Array.isArray(t.args) ? t.args : Object.values(t.args))
      if (t?.list) return scan(t.list)
      return false // subqueries decide for themselves
    })
  }
  return tokenStreams.some(scan)
}

/**
 * Transforms a query object for INSERT or UPSERT operations by modifying the `into` clause.
 *
 * @param {string} kind - The type of operation: "INSERT" or "UPSERT".
 *
 * @returns {object} - The transformed query with updated `into` clause.
 */
function transformQueryForInsertUpsert(ctx, kind) {
  const { as } = ctx.transformedQuery[kind].into
  const target = ctx.query._target
  ctx.transformedQuery[kind].into = { ref: [target.name] }
  if (as) ctx.transformedQuery[kind].into.as = as
  return ctx.transformedQuery
}

function getTransformedOrderByGroupBy(ctx, columns, inOrderBy = false) {
  const res = []
  for (let i = 0; i < columns.length; i++) {
    let col = columns[i]
    if (isCalculatedOnRead(col.$refLinks?.[col.$refLinks.length - 1].definition)) {
      const calcElement = columnsModule.resolveCalculatedElement(ctx, col, true)
      res.push(calcElement)
    } else if (pseudos.elements[col.ref?.[0]]) {
      res.push({ ...col })
    } else if (col.ref) {
      if (
        col.$refLinks.some(link => {
          const def = ctx.getDefinition(link.definition.target)
          return hasOwnSkip(def) && !isRuntimeView(def)
        })
      )
        continue
      if (col.ref.length > 1 && col.ref[0] === '$self' && !col.$refLinks[0].definition.kind) {
        const dollarSelfReplacement = columnsModule.calculateDollarSelfColumn(ctx, col)
        res.push(...getTransformedOrderByGroupBy(ctx, [dollarSelfReplacement], inOrderBy))
        continue
      }
      const { target, definition } = col.$refLinks[0]
      let tableAlias = null
      if (target.SELECT?.columns && inOrderBy) {
        // usually TA is omitted if order by ref is a column
        // if a localized sorting is requested, we add `COLLATE`s
        // later on, which transforms the simple name to an expression
        // --> in an expression, only source elements can be addressed, hence we must add TA
        if (target.SELECT.localized && definition.type === 'cds.String') {
          const referredCol = target.SELECT.columns.find(c => {
            return c.as === col.ref[0] || c.ref?.at(-1) === col.ref[0]
          })
          if (referredCol) {
            // keep sort and nulls properties
            referredCol.sort = col.sort
            referredCol.nulls = col.nulls
            col = referredCol
            if (definition.kind === 'element') {
              tableAlias = sourcesModule.getTableAlias(ctx, col)
            } else {
              // we must replace the reference with the underlying expression
              const { val, func, args, xpr } = col
              if (val) res.push({ val })
              if (func) res.push({ func, args })
              if (xpr) res.push({ xpr })
              continue
            }
          }
        }
      } else {
        tableAlias = sourcesModule.getTableAlias(ctx, col) // do not prepend TA if orderBy column addresses element of query
      }
      const leaf = col.$refLinks[col.$refLinks.length - 1].definition
      if (leaf.virtual === true) continue // already in getFlatColumnForElement
      let baseName
      if (col.ref.length >= 2) {
        // leaf might be intermediate structure
        baseName = col.ref
          .map(idOnly)
          .slice(col.ref[0] === tableAlias ? 1 : 0, col.ref.length - 1)
          .join('_')
      }
      const flatColumns = flattenModule.getFlatColumnsFor(ctx, col, { baseName, tableAlias })
      /**
       * We can't guarantee that the element order will NOT change in the future.
       * We claim that the element order doesn't matter, hence we can't allow elements
       * in the order by clause which expand to more than one column, as the order impacts
       * the result.
       */
      if (inOrderBy && flatColumns.length > 1)
        throw new Error(
          `Structured element “${getFullName(leaf)}” expands to multiple fields and can't be used in order by`,
        )
      flatColumns.forEach(fc => {
        if (col.nulls) fc.nulls = col.nulls
        if (col.sort) fc.sort = col.sort
        if (fc.as) delete fc.as
      })
      res.push(...flatColumns)
    } else {
      let transformedColumn
      if (col.SELECT) transformedColumn = sourcesModule.transformSubquery(ctx, col)
      else if (col.xpr) transformedColumn = { xpr: expressionsModule.getTransformedTokenStream(ctx, col.xpr) }
      else if (col.func)
        transformedColumn = { args: expressionsModule.getTransformedFunctionArgs(ctx, col.args), func: col.func }
      // val
      else transformedColumn = { ...col }
      if (col.sort) transformedColumn.sort = col.sort
      if (col.nulls) transformedColumn.nulls = col.nulls
      res.push(transformedColumn)
    }
  }
  return res
}
