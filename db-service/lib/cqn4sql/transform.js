'use strict'

module.exports = transformOwned

const search = require('./search')
const select = require('./select')
const expressions = require('./expressions')
const sources = require('./sources')
const joins = require('./joins')
const runtimeViews = require('./runtime-views')

const cds = require('@sap/cds')
const resolve = require('./resolve')
const { getImplicitAlias: _getImplicitAlias, defineProperty, getModelUtils } = require('../utils')
const { assignQueryModifiers, getPrimaryKey } = require('./helpers')

function transformOwned(query, model, useTechnicalAlias, state) {
  const getImplicitAlias = str => _getImplicitAlias(str, useTechnicalAlias)
  const { getLocalizedName, isLocalized, getDefinition } = getModelUtils(model, query)
  let transformedQuery
  const ctx = {
    model,
    useTechnicalAlias,
    state,
    getImplicitAlias,
    getLocalizedName,
    isLocalized,
    getDefinition,
    query,
    get transformedQuery() {
      return transformedQuery
    },
  }
  const hasCustomJoins = query.SELECT?.from.args && (!query.joinTree || query.joinTree.isInitial)

  if (!hasCustomJoins && query.SELECT?.search) {
    // we need an instance of query because the elements of the query are needed for the calculation of the search columns
    if (!query.SELECT.elements) Object.setPrototypeOf(query, SELECT.class.prototype)
    const searchTerm = search.getSearch(ctx, query.SELECT.search, query)
    if (searchTerm) {
      // Search target can be a navigation, in that case use _target to get the correct entity
      const { where, having } = search.transformSearch(ctx, searchTerm)
      if (where) query.SELECT.where = where
      else if (having) query.SELECT.having = having
      // Defer the ranking ORDER BY until references are resolved, where the outer table alias is known and the
      // deep-search sub-select can be correlated to the outer row (see buildSearchRankOrderBy).
      defineProperty(query, '$searchRank', searchTerm)
    }
  }
  // query modifiers can also be defined in from ref leaf infix filter
  // > SELECT from bookshop.Books[order by price] {ID}
  if (query.SELECT?.from.ref?.at(-1).id) {
    assignQueryModifiers(query.SELECT, query.SELECT.from.ref.at(-1))
  }
  if (query.DELETE?.from.ref?.at(-1).id) {
    assignQueryModifiers(query.DELETE, query.DELETE.from.ref.at(-1))
  }
  if (query.UPDATE?.entity.ref?.at(-1).id) {
    assignQueryModifiers(query.UPDATE, query.UPDATE.entity.ref.at(-1))
  }
  const resolution = resolve(query, model, useTechnicalAlias, false, state)
  ctx.wildcardCalculations = resolution.wildcardCalculations
  ctx.calculatedValues = resolution.calculatedValues
  ctx.projectionPlans = resolution.projectionPlans
  // Custom joins keep their shape; source resolution supplies renderer metadata.
  if (hasCustomJoins) return query

  transformedQuery = cds.ql.clone(query)
  const kind = query.kind || Object.keys(query)[0]

  if (query.INSERT || query.UPSERT) {
    transformedQuery = select.transformQueryForInsertUpsert(ctx, kind)
  } else {
    const queryProp = query[kind]
    const { entity, where } = queryProp
    const from = queryProp.from

    const transformedProp = { __proto__: queryProp } // IMPORTANT: don't lose anything you might not know of
    const queryNeedsJoins = query.joinTree && !query.joinTree.isInitial

    // Transform the existing where, prepend table aliases, and so on...
    if (where) {
      transformedProp.where = expressions.getTransformedTokenStream(ctx, where, { prop: 'where' })
    }

    // Transform the from clause: association path steps turn into `WHERE EXISTS` subqueries.
    // The already transformed `where` clause is then glued together with the resulting subqueries.
    const { transformedWhere, transformedFrom } = sources.getTransformedFrom(ctx, from || entity, transformedProp.where)

    // build a subquery for DELETE / UPDATE queries with path expressions and match the primary keys
    if (queryNeedsJoins && (query.UPDATE || query.DELETE)) {
      const prop = query.UPDATE ? 'UPDATE' : 'DELETE'
      const subquery = {
        SELECT: {
          from: { ...(from || entity) },
          columns: [], // primary keys of the query target will be added later
          where: [...where],
        },
      }
      // The alias of the original query is now the alias for the subquery
      // so that potential references in the where clause to the alias match.
      // Hence, replace the alias of the original query with the next
      // available alias, so that each alias is unique.
      const uniqueSubqueryAlias = sources.getNextAvailableTableAlias(ctx, transformedFrom.as)
      transformedFrom.as = uniqueSubqueryAlias

      // calculate the primary keys of the target entity, there is always exactly
      // one query source for UPDATE / DELETE
      const queryTarget = Object.values(query.sources)[0].definition
      const primaryKey = { list: getPrimaryKey(queryTarget, uniqueSubqueryAlias) }
      // match primary keys of the target entity with the subquery
      primaryKey.list.forEach(k => subquery.SELECT.columns.push({ ref: k.ref.slice(1) }))

      const transformedSubquery = transformOwned(subquery, model, useTechnicalAlias, state)

      // replace where condition of original query with the transformed subquery
      // correlate UPDATE / DELETE query with subquery by primary key matches
      transformedQuery[prop].where = [primaryKey, 'in', transformedSubquery]

      if (prop === 'UPDATE') transformedQuery.UPDATE.entity = transformedFrom
      else transformedQuery.DELETE.from = transformedFrom

      return transformedQuery
    }

    if (query.SELECT) {
      transformedQuery = select.transformSelectQuery(
        ctx,
        queryProp,
        transformedFrom,
        transformedWhere,
        transformedQuery,
      )
    } else {
      if (from) {
        transformedProp.from = transformedFrom
      } else if (!queryNeedsJoins) {
        transformedProp.entity = transformedFrom
      }

      if (transformedWhere?.length > 0) {
        transformedProp.where = transformedWhere
      }

      transformedQuery[kind] = transformedProp

      if (query.UPDATE?.with) {
        Object.entries(query.UPDATE.with).forEach(([key, val]) => {
          const transformed = expressions.getTransformedTokenStream(ctx, [val])
          query.UPDATE.with[key] = transformed[0]
        })
      }
    }

    if (queryNeedsJoins) {
      transformedQuery[kind].from = joins.translateAssocsToJoins(ctx, transformedQuery[kind].from)
    }
  }

  if (cds.env.features.runtime_views) runtimeViews.processRuntimeViews(ctx, transformedQuery, model)

  return transformedQuery
}
