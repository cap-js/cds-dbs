'use strict'

module.exports = { resolveInline, resolveExpand }

const referencesModule = require('./references')
const calculatedModule = require('./calculated')

const cds = require('@sap/cds')
const { resolveQuery } = require('../resolve')
const { planFor } = require('../projection-plan')
const { defineProperty } = require('../../utils')
const { keysOf } = require('../model')
const { idOnly, getCdsTypeForVal } = require('./helpers')

/**
 * Resolves and processes the inline attribute of a column in a database query.
 *
 * @param {object} col - The column object with properties: `inline` and `$refLinks`.
 * @param {string} [namePrefix=col.as || col.flatName] - Prefix for naming new columns. Defaults to `col.as` or `col.flatName`.
 * @returns {object} - An object with resolved and processed inline column definitions.
 *
 * Procedure:
 * 1. Iterate through `inline` array. For each `inlineCol`:
 *    a. If `inlineCol` equals '*', wildcard elements are processed and added to the `elements` object.
 *    b. If `inlineCol` has inline or expand attributes, corresponding functions are called recursively and the resulting elements are added to the `elements` object.
 *    c. If `inlineCol` has val or func attributes, new elements are created and added to the `elements` object.
 *    d. Otherwise, the corresponding `$refLinks` definition is added to the `elements` object.
 * 2. Returns the `elements` object.
 */
function resolveInline(ctx, col, namePrefix = col.as || col.flatName, outerBase = null) {
  const { inline, $refLinks } = col
  const $leafLink = $refLinks[$refLinks.length - 1]
  if (!$leafLink.definition.target && !$leafLink.definition.elements) {
    throw new Error(
      `Unexpected “inline” on “${col.ref.map(idOnly)}”; can only be used after a reference to a structure, association or table alias`,
    )
  }
  const effectiveBase = outerBase
    ? { ref: [...outerBase.ref, ...col.ref], $refLinks: [...outerBase.$refLinks, ...col.$refLinks] }
    : col
  let elements = {}
  const plan = planFor(ctx, col, 'inline')
  if (plan.duplicate)
    throw new Error('Duplicate wildcard "*" in inline of "' + (col.as || col.ref.map(idOnly).join('_')) + '"')
  inline.forEach(inlineCol => {
    referencesModule.resolveExpression(ctx, inlineCol, null, $leafLink, { inXpr: true, baseColumn: effectiveBase })
    if (inlineCol === '*') {
      const wildCardElements = {}
      // either the `.elements´ of the struct or the `.elements` of the assoc target
      const targetDef = ctx.getDefinition($leafLink.definition.target)
      const leafLinkElements = targetDef?.elements || $leafLink.definition.elements
      const isAssociation = !!$leafLink.definition.target

      const deferredCalcElements = []
      Object.entries(leafLinkElements).forEach(([k, v]) => {
        const name = namePrefix ? `${namePrefix}_${k}` : k
        // if overwritten/excluded omit from wildcard elements
        // in elements the names are already flat so consider the prefix
        // in excluding, the elements are addressed without the prefix
        if (!(name in elements || plan.exclude.has(k))) {
          wildCardElements[name] = v

          if (v.value) {
            // defer linkCalculatedElement calls until after all association joins are registered
            // so that the join tree order is correct
            deferredCalcElements.push({ k, v })
          } else if (
            isAssociation &&
            !v.virtual &&
            v.type !== 'cds.LargeBinary' &&
            !(v.on && !keysOf(v, ctx.state.metadata))
          ) {
            // Check if this element is a foreign key (FK elements don't need join)
            const isFK = keysOf($leafLink.definition, ctx.state.metadata)?.some(key => key.ref[0] === k)
            if (!isFK) {
              // Create a fake column with ref [<inlined assoc>, <element name>] and proper $refLinks
              const fakeCol = {
                ref: [...col.ref, k],
              }
              // Copy $refLinks and add new link for the target element with proper alias
              const fakeRefLinks = [...$refLinks, { definition: v, target: targetDef, alias: k }]
              defineProperty(fakeCol, '$refLinks', fakeRefLinks)
              defineProperty(fakeCol, 'isJoinRelevant', true)
              // Merge into join tree
              ctx.query.joinTree.mergeColumn(fakeCol, ctx.query.outerQueries)
            }
          }
        }
      })
      // link calculated elements after association joins are registered in the join tree
      const calculations = new Map()
      ctx.wildcardCalculations.set(col, calculations)
      for (const { k, v } of deferredCalcElements) {
        const occurrence = { ref: [k], $refLinks: [{ definition: v, target: targetDef }] }
        calculations.set(k, occurrence)
        calculatedModule.linkCalculatedElement(ctx, occurrence, $leafLink, effectiveBase)
      }
      Object.assign(elements, wildCardElements)
    } else {
      const nameParts = namePrefix ? [namePrefix] : []
      if (inlineCol.as) nameParts.push(inlineCol.as)
      else if (inlineCol.ref) nameParts.push(...inlineCol.ref.map(idOnly))
      const name = nameParts.join('_')
      if (inlineCol.inline) {
        const inlineElements = resolveInline(ctx, inlineCol, name, effectiveBase)
        Object.assign(elements, inlineElements)
      } else if (inlineCol.expand) {
        const expandElements = resolveExpand(ctx, inlineCol)
        elements[name] = expandElements
      } else if (inlineCol.val) {
        elements[name] = getCdsTypeForVal(inlineCol.val)
      } else if (inlineCol.func) {
        elements[name] = {}
      } else if (inlineCol.xpr) {
        elements[name] = {}
      } else {
        elements[name] = inlineCol.$refLinks[inlineCol.$refLinks.length - 1].definition
      }
    }
  })
  return elements
}

/**
 * Resolves a query column which has an `expand` property.
 *
 * @param {object} col - The column object with properties: `expand` and `$refLinks`.
 * @returns {object} - A `cds.struct` object with expanded column definitions.
 *
 * Procedure:
 * - if `$leafLink` is an association, constructs an `expandSubquery` and infers a new query structure.
 *   Returns a new `cds.struct` if the association has a target cardinality === 1 or a `cds.array` for to many relations.
 * - else constructs an `elements` object based on the refs `expand` found in the expand and returns a new `cds.struct` with these `elements`.
 */
function resolveExpand(ctx, col) {
  const { expand, $refLinks } = col
  const $leafLink = $refLinks?.[$refLinks.length - 1] || ctx.query.SELECT.from.$refLinks.at(-1) // fallback to anonymous expand
  if (!$leafLink.definition.target && !$leafLink.definition.elements) {
    throw new Error(
      `Unexpected “expand” on “${col.ref.map(idOnly)}”; can only be used after a reference to a structure, association or table alias`,
    )
  }
  const plan = planFor(ctx, col, 'expand')
  if (plan.duplicate)
    throw new Error('Duplicate wildcard "*" in expand of "' + (col.as || col.ref.map(idOnly).join('_')) + '"')
  const target = ctx.getDefinition($leafLink.definition.target)
  if (target) {
    // The expand will be resolved in its own SQL scope. Inferring it here
    // would walk it twice and attach links for the wrong aliases. Grouped
    // expands need their nested links to correlate against the GROUP BY.
    if (!ctx.resolveNestedElements && !ctx.clause.groupBy) {
      const res = $leafLink.definition.is2one ? new cds.struct() : new cds.array({ items: new cds.struct() })
      return defineProperty(res, '$assocExpand', true)
    }
    const expandSubquery = {
      SELECT: {
        from: target.name,
        columns: expand.filter(c => !c.inline),
      },
    }
    if (col.excluding) expandSubquery.SELECT.excluding = col.excluding
    if (col.as) expandSubquery.SELECT.as = col.as
    const inferredExpandSubquery = resolveQuery(
      ctx,
      expandSubquery,
      ctx.model,
      undefined,
      ctx.resolveNestedElements || !!ctx.clause.groupBy,
    )
    const res = $leafLink.definition.is2one
      ? new cds.struct({ elements: inferredExpandSubquery.elements })
      : new cds.array({ items: new cds.struct({ elements: inferredExpandSubquery.elements }) })
    return defineProperty(res, '$assocExpand', true)
  } else if ($leafLink.definition.elements) {
    let elements = {}
    expand.forEach(e => {
      if (e === '*') {
        Object.assign(elements, $leafLink.definition.elements)
      } else {
        referencesModule.resolveExpression(ctx, e, false, $leafLink, { inXpr: true })
        if (e.expand) elements[e.as || e.flatName] = resolveExpand(ctx, e)
        if (e.inline) Object.assign(elements, resolveInline(ctx, e))
        else elements[e.as || e.flatName] = e.$refLinks ? e.$refLinks[e.$refLinks.length - 1].definition : e
      }
    })
    return new cds.struct({ elements })
  }
}
