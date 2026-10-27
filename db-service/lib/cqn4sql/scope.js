'use strict'

module.exports = { createState, createScope, getCalculatedValue }

const cloneCqn = require('./clone')
const { getModelUtils, getImplicitAlias } = require('../utils')

function createState() {
  return { resolutions: new WeakMap(), metadata: new WeakMap(), sourceAliases: new WeakMap() }
}

function createScope(query, model, useTechnicalAlias = true, resolveNestedElements = false, state = createState()) {
  if (!model) throw new Error('Please specify a model')
  if (query.SET) throw new Error('”UNION” based queries are not supported')
  return {
    model,
    state,
    useTechnicalAlias,
    resolveNestedElements,
    query,
    clause: query.SELECT || query.INSERT || query.UPSERT || query.UPDATE || query.DELETE || query.CREATE || query.DROP,
    ...getModelUtils(model, query),
    getImplicitAlias: name => getImplicitAlias(name, useTechnicalAlias),
    alreadySeenCalcElements: new Set(),
    calculatedValues: new WeakMap(),
    projectionPlans: new WeakMap(),
  }
}

// Calculated expressions are scoped to their occurrence (implicit wildcard
// members use their definition). Inline rewriting carries the binding forward.
function getCalculatedValue(ctx, occurrence) {
  const element = occurrence.$refLinks?.at(-1).definition || occurrence
  if (!ctx.calculatedValues.has(occurrence)) ctx.calculatedValues.set(occurrence, cloneCqn(element.value))
  return ctx.calculatedValues.get(occurrence)
}
