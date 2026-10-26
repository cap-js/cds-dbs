'use strict'

const { planFor, validateSelfDependencies } = require('../projection-plan')

module.exports = { resolveColumns, resolveWildcard, getElementForXprOrSubquery }

const referencesModule = require('./references')
const calculatedModule = require('./calculated')

const cds = require('@sap/cds')
const { isCalculatedOnRead } = require('../../utils')
const {
  applyToFunctionArgs,
  setElementOnColumns,
  rejectDuplicatedElement,
  getElementForCast,
  getCopyWithAnnos,
  getCdsTypeForVal,
  getDefinitionFromSources,
} = require('./helpers')

/**
 * Walks over all columns of a query's `SELECT` and infers each `ref`, `xpr`, or `val` as a query element
 * based on the query's `$combinedElements` and `sources`.
 *
 * The inferred `elements` are attached to the query as a non-enumerable property.
 *
 * Also walks over other `ref`s in the query, validates them, and attaches `$refLinks`.
 * This includes handling `where`, infix filters within column `refs`, or other `csn` paths.
 *
 * @param {object} $combinedElements The `$combinedElements` dictionary of the query, which maps element names
 *                                   to an array of objects containing the index and table alias where the element can be found.
 * @returns {object} The inferred `elements` dictionary of the query, which maps element names to their corresponding definitions.
 */
function resolveColumns(ctx) {
  let queryElements = {}
  const plan = planFor(ctx, ctx.clause)
  const { columns, where, groupBy, having, orderBy } = ctx.clause
  if (!columns) {
    if (ctx.query.SELECT || ctx.resolveNestedElements) resolveWildcard(ctx, queryElements)
  } else {
    if (plan.duplicate) throw new Error('Duplicate wildcard "*" in column list')
    const dollarSelfRefs = []
    columns.forEach(col => {
      if (col === '*') {
        // Wildcard members are resolved after explicit replacements.
      } else if (col.val !== undefined || col.xpr || col.SELECT || col.func || col.param) {
        const as = col.as || col.func || col.val
        if (as === undefined) cds.error`Expecting expression to have an alias name`
        if (queryElements[as]) rejectDuplicatedElement(as)
        if (col.xpr || col.SELECT) {
          queryElements[as] = getElementForXprOrSubquery(ctx, col, queryElements, dollarSelfRefs)
        }
        if (col.func) {
          if (col.args) {
            // {func}.args are optional
            applyToFunctionArgs(col.args, (...args) => referencesModule.resolveExpression(ctx, ...args), [
              false,
              null,
              { dollarSelfRefs },
            ])
          }
          queryElements[as] = getElementForCast(col)
        }
        if (!queryElements[as]) {
          // either binding parameter (col.param) or value
          queryElements[as] = col.cast ? getElementForCast(col) : getCdsTypeForVal(col.val)
        }
        setElementOnColumns(col, queryElements[as])
      } else if (col.ref) {
        const firstStepIsTableAlias =
          (col.ref.length > 1 && col.ref[0] in ctx.sources) ||
          // nested projection on table alias
          (col.ref.length === 1 && col.ref[0] in ctx.sources && col.inline)
        const firstStepIsSelf =
          !firstStepIsTableAlias && col.ref.length > 1 && ['$self', '$projection'].includes(col.ref[0])
        // we must handle $self references after the query elements have been calculated
        if (firstStepIsSelf) dollarSelfRefs.push(col)
        else handleRef(col)
      } else if (col.expand) {
        referencesModule.resolveExpression(ctx, col, queryElements, null)
      } else {
        cds.error`Not supported: ${JSON.stringify(col)}`
      }
    })

    if (dollarSelfRefs.length) {
      const pending = new Set(dollarSelfRefs)
      for (const column of validateSelfDependencies(plan, ctx.sources)) {
        if (pending.delete(column)) handleRef(column, column.inXpr)
      }
      for (const column of pending) handleRef(column, column.inXpr)
    }

    if (plan.wildcard !== -1) resolveWildcard(ctx, queryElements)
  }
  if (orderBy) {
    for (const column of columns || []) if (column.flatName && !column.as) plan.byName.set(column.flatName, column)
    // link $refLinks -> special name resolution rules for orderBy
    orderBy.forEach(token => {
      let $baseLink
      let needsElementsOfQueryAsBase
      // first check if token ref is resolvable in query elements
      if (columns) {
        const firstStep = token.ref?.[0].id || token.ref?.[0]
        const tokenPointsToQueryElements = plan.byName.has(firstStep)
        needsElementsOfQueryAsBase =
          tokenPointsToQueryElements &&
          queryElements[firstStep] &&
          /* expand on structure can be addressed */ !queryElements[firstStep].$assocExpand

        if (needsElementsOfQueryAsBase) $baseLink = { definition: { elements: queryElements }, target: ctx.query }
      } else {
        // fallback to elements of query source
        $baseLink = null
      }

      referencesModule.resolveExpression(ctx, token, queryElements, $baseLink, { inQueryModifier: true })
      // if the ref points into the query itself and follows an exposed association
      // to a non-fk column, we must reject the ref, as we can't join with the queries own results
      if (token.isJoinRelevant && needsElementsOfQueryAsBase) {
        // reverse the array, find the last association and calculate the index of the association in non-reversed order
        const assocIndex =
          token.$refLinks.length - 1 - token.$refLinks.reverse().findIndex(link => link.definition.isAssociation)

        throw new Error(
          `Can follow managed association “${token.ref[assocIndex].id || token.ref[assocIndex]}” only to the keys of its target, not to “${token.ref[assocIndex + 1].id || token.ref[assocIndex + 1]}”`,
        )
      }
    })
  }

  // walk over all paths in other query properties
  if (where) walkTokenStream(where, true)
  if (groupBy) walkTokenStream(groupBy)
  if (having) walkTokenStream(having)
  if (ctx.clause.with)
    // consider UPDATE.with
    Object.values(ctx.clause.with).forEach(val =>
      referencesModule.resolveExpression(ctx, val, queryElements, null, { inXpr: true }),
    )

  return queryElements

  /**
   * Recursively drill down into a tokenStream (`where` or `having`) and pass
   * on the information whether the next token is resolved within an `exists` predicates.
   * If such a token has an infix filter, it is not join relevant, because the filter
   * condition is applied to the generated `exists <subquery>` condition.
   *
   * @param {array} tokenStream
   */
  function walkTokenStream(tokenStream, inXpr = false) {
    let skipJoins
    const processToken = t => {
      if (t === 'exists') {
        // no joins for infix filters along `exists <path>`
        skipJoins = true
      } else if (t.xpr) {
        // don't miss an exists within an expression
        t.xpr.forEach(processToken)
      } else {
        referencesModule.resolveExpression(ctx, t, queryElements, null, {
          inExists: skipJoins,
          inXpr,
          inQueryModifier: true,
        })
        skipJoins = false
      }
    }
    tokenStream.forEach(processToken)
  }
  function handleRef(col, inXpr) {
    referencesModule.resolveExpression(ctx, col, queryElements, null, { inXpr })
    const { definition } = col.$refLinks[col.$refLinks.length - 1]
    if (col.cast)
      // final type overwritten -> element not visible anymore
      setElementOnColumns(col, getElementForCast(col))
    else if ((col.ref.length === 1) & (col.ref[0] === '$user'))
      // shortcut to $user.id
      setElementOnColumns(col, queryElements[col.as || '$user'])
    else setElementOnColumns(col, definition)
  }
}

/**
 * Iterates over all `$combinedElements` of the `query` and puts them into the `query`s `elements`,
 * if there is not already an element with the same name present.
 */
function resolveWildcard(ctx, queryElements) {
  const exclude = ctx.clause.excluding ? x => ctx.clause.excluding.includes(x) : () => false

  if (Object.keys(queryElements).length === 0 && ctx.aliases.length === 1) {
    const { elements } = getDefinitionFromSources(ctx.sources, ctx.aliases[0])
    // only one query source and no overwritten columns
    for (const k in elements) {
      if (!exclude(k)) {
        const element = elements[k]
        if (element.type !== 'cds.LargeBinary' && element.type !== 'cds.Vector') {
          queryElements[k] = element
        }
        // only relevant if we actually select the calculated element
        if (ctx.query.SELECT && isCalculatedOnRead(element)) {
          calculatedModule.linkCalculatedElement(ctx, element)
        }
      }
    }
    return
  }

  const ambiguousElements = {}
  Object.entries(ctx.query.$combinedElements).forEach(([name, tableAliases]) => {
    if (Object.keys(tableAliases).length > 1) {
      ambiguousElements[name] = tableAliases
      return ambiguousElements[name]
    }
    if (exclude(name) || name in queryElements) return true
    const element = tableAliases[0].tableAlias.elements[name]
    if (element.type !== 'cds.LargeBinary' && element.type !== 'cds.Vector') queryElements[name] = element
    if (isCalculatedOnRead(element)) {
      calculatedModule.linkCalculatedElement(ctx, element)
    }
  })

  if (Object.keys(ambiguousElements).length > 0) throwAmbiguousWildcardError()

  function throwAmbiguousWildcardError() {
    const err = []
    err.push('Ambiguous wildcard elements:')
    Object.keys(ambiguousElements).forEach(name => {
      const tableAliasNames = Object.values(ambiguousElements[name]).map(v => v.index)
      err.push(
        `       select "${name}" explicitly with ${tableAliasNames.map(taName => `"${taName}.${name}"`).join(', ')}`,
      )
    })
    throw new Error(err.join('\n'))
  }
}

/**
 * Returns a new object which is the inferred element for the given `col`.
 * A cast type (via cast function) on the column gets preserved.
 *
 * @param {object} col
 * @returns object
 */
function getElementForXprOrSubquery(ctx, col, queryElements, dollarSelfRefs) {
  const { xpr } = col
  let skipJoins = false
  xpr?.forEach(token => {
    if (token === 'exists') {
      // no joins for infix filters along `exists <path>`
      skipJoins = true
    } else {
      referencesModule.resolveExpression(ctx, token, queryElements, null, {
        inExists: skipJoins,
        inXpr: true,
        dollarSelfRefs,
      })
      skipJoins = false
    }
  })
  const base = getElementForCast(col.cast ? col : xpr?.[0] || col)
  if (col.key) base.key = col.key // > preserve key on column
  return getCopyWithAnnos(col, base, ctx.resolveNestedElements)
}
