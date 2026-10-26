'use strict'

module.exports = Object.assign(resolve, { resolveQuery })

const sources = require('./resolve/sources')
const columns = require('./resolve/columns')

const { getModelUtils, defineProperty } = require('../utils')
const { createState } = require('./scope')

/**
 * Plan SQL references and joins on an owned query. Definitions are read-only;
 * calculated expressions and their reference links belong to this query scope.
 * Collect element metadata while resolving references. Association expands are
 * resolved in their own SQL scope; only the compatibility API and grouped
 * expands require their nested result metadata ahead of transformation.
 */
function resolve(query, model, useTechnicalAlias = true, resolveNestedElements = false, state = createState()) {
  if (!model) throw new Error('Please specify a model')
  if (query.SET) throw new Error('”UNION” based queries are not supported')
  const calculatedValues = new WeakMap()
  const ctx = {
    model,
    state,
    useTechnicalAlias,
    resolveNestedElements,
    query,
    clause: query.SELECT || query.INSERT || query.UPSERT || query.UPDATE || query.DELETE || query.CREATE || query.DROP,
    ...getModelUtils(model, query),
    alreadySeenCalcElements: new Set(),
    wildcardCalculations: new WeakMap(),
    calculatedValues,
    projectionPlans: new WeakMap(),
  }

  ctx.sources = sources.resolveSources(
    ctx,
    ctx.clause.into || ctx.clause.from || ctx.clause.entity,
    {},
    useTechnicalAlias,
  )
  ctx.aliases = Object.keys(ctx.sources)
  ctx.target = ctx.aliases.length === 1 ? ctx.sources[ctx.aliases[0]].definition : query
  defineProperty(query, 'sources', ctx.sources)
  defineProperty(query, '_target', ctx.target)
  if (query.SELECT || query.DELETE || query.UPDATE) {
    Object.defineProperty(query, '$combinedElements', {
      configurable: true,
      get() {
        const elements = sources.combineElements(ctx)
        defineProperty(query, '$combinedElements', elements)
        return elements
      },
    })
    const elements = columns.resolveColumns(ctx)
    if (query.SELECT || resolveNestedElements) defineProperty(query, 'elements', elements)
  }
  state.resolutions.set(query, ctx)
  return ctx
}

function resolveQuery(ctx, query, model, aliases, full = ctx.resolveNestedElements) {
  const previous = ctx.state.resolutions.get(query)
  if (!previous || (full && !previous.resolveNestedElements)) resolve(query, model, aliases, full, ctx.state)
  return query
}
