'use strict'

module.exports = { resolveInline, resolveExpand }

const referencesModule = require('./references')
const calculatedModule = require('./calculated')

const cds = require('@sap/cds')
const { resolveQuery } = require('../resolve')
const { planFor, qualifyNestedColumn } = require('../projection-plan')
const { defineProperty } = require('../../utils')
const { keysOf } = require('../model')
const { idOnly, getCdsTypeForVal } = require('./helpers')

function resolveInline(ctx, col, namePrefix = col.as || col.flatName, outerBase = null) {
  return resolveNestedProjection(ctx, col, 'inline', namePrefix, outerBase)
}

function resolveExpand(ctx, col, outerBase = null) {
  const { expand } = col
  const $leafLink = projectionBase(ctx, col, 'expand')
  const target = ctx.getDefinition($leafLink.definition.target)
  if (target) {
    // The expand will be resolved in its own SQL scope. Inferring it here
    // would walk it twice and attach links for the wrong aliases. Grouped
    // expands need their nested links to correlate against the GROUP BY.
    let elements
    if (ctx.resolveNestedElements || ctx.clause.groupBy) {
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
      elements = inferredExpandSubquery.elements
    }
    const struct = new cds.struct(elements ? { elements } : {})
    const res = $leafLink.definition.is2one ? struct : new cds.array({ items: struct })
    return defineProperty(res, '$assocExpand', true)
  }
  return new cds.struct({ elements: resolveNestedProjection(ctx, col, 'expand', '', outerBase) })
}

// Preserve result-shape metadata and SQL projection entries in the same walk.
// Inline metadata has flattened names; structure expands retain a nested shape.
function resolveNestedProjection(ctx, col, prop, namePrefix, outerBase) {
  const leaf = projectionBase(ctx, col, prop)
  const base = nestedBase(col, outerBase)
  const plan = planFor(ctx, col, prop)
  const elements = (plan.elements = {})
  plan.columns.forEach((column, i) => {
    if (column === '*') {
      if (prop === 'inline') resolveInlineWildcard(ctx, plan, leaf, base, namePrefix, elements)
      else Object.assign(elements, leaf.definition.elements)
      return
    }
    referencesModule.resolveExpression(ctx, column, null, leaf, {
      inXpr: true,
      inNestedProjection: true,
      baseColumn: base.ref ? base : null,
    })
    const localName = column.as || column.ref?.map(idOnly).join('_')
    const name = [namePrefix, localName].filter(Boolean).join('_')
    if (column.inline) Object.assign(elements, resolveInline(ctx, column, name, base))
    else if (column.expand) elements[name] = resolveExpand(ctx, column, base)
    else if (column.$refLinks) elements[name] = column.$refLinks.at(-1).definition
    else
      elements[name] = prop === 'expand' ? { ...column } : column.val !== undefined ? getCdsTypeForVal(column.val) : {}

    const sqlName = [base.as || base.ref?.map(idOnly).join('_'), localName || column.func || 'expr' + i]
      .filter(Boolean)
      .join('_')
    const alias = base.as || column.as || column.$refLinks?.at(-1).definition.value || column.isJoinRelevant
    qualifyNestedColumn(column, base)
    if (alias || !column.ref) column.as = sqlName
  })
  return elements
}

function resolveInlineWildcard(ctx, plan, leaf, base, prefix, elements) {
  const target = ctx.getDefinition(leaf.definition.target)
  const calculations = (plan.calculations = new Map())
  const foreignKeys = new Set(target ? keysOf(leaf.definition, ctx.state.metadata)?.map(key => key.ref[0]) : [])
  for (const [name, element] of Object.entries(target?.elements || leaf.definition.elements)) {
    const outputName = prefix ? prefix + '_' + name : name
    if (outputName in elements || plan.exclude.has(name)) continue
    elements[outputName] = element
    if (element.value) {
      calculations.set(name, { ref: [name], $refLinks: [{ definition: element, target }] })
    } else if (
      target &&
      !foreignKeys.has(name) &&
      !element.virtual &&
      element.type !== 'cds.LargeBinary' &&
      !(element.on && !keysOf(element, ctx.state.metadata))
    ) {
      const column = { ref: [name] }
      referencesModule.resolveExpression(ctx, column, null, leaf, { inXpr: true, baseColumn: base })
    }
  }
  // Calculations follow ordinary wildcard members so join aliases stay stable.
  for (const column of calculations.values()) calculatedModule.linkCalculatedElement(ctx, column, leaf, base)
}

function projectionBase(ctx, column, prop) {
  const leaf = column.$refLinks?.at(-1) || ctx.query.SELECT.from.$refLinks.at(-1)
  if (!leaf.definition.target && !leaf.definition.elements) {
    throw new Error(
      `Unexpected “${prop}” on “${column.ref.map(idOnly)}”; can only be used after a reference to a structure, association or table alias`,
    )
  }
  if (planFor(ctx, column, prop).duplicate)
    throw new Error(
      'Duplicate wildcard "*" in ' + prop + ' of "' + (column.as || column.ref.map(idOnly).join('_')) + '"',
    )
  return leaf
}

function nestedBase(column, parent) {
  if (!parent) return column
  return {
    ref: [...(parent.ref || []), ...column.ref],
    $refLinks: [...(parent.$refLinks || []), ...column.$refLinks],
    flatName: [parent.flatName, column.flatName].filter(Boolean).join('_'),
    isJoinRelevant: parent.isJoinRelevant || column.isJoinRelevant,
    as: parent.as ? [parent.as, column.as || column.ref.map(idOnly).join('_')].join('_') : column.as,
  }
}
