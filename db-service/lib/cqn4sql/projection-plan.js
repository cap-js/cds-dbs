'use strict'

const { defineProperty } = require('../utils')
const { forEachChild } = require('./expression-tree')
const cloneCqn = require('./clone')

// Preserve column order while indexing the names used by smart wildcards,
// exclusions, replacements, ORDER BY, and $self dependencies.
function projectionPlan(columns = ['*'], excluding = []) {
  const byName = new Map()
  const exclude = new Map(excluding.map(name => [name, name]))
  const replace = new Map()
  let wildcard = -1
  for (let i = 0; i < columns.length; i++) {
    const column = columns[i]
    if (column === '*') {
      if (wildcard !== -1) return { duplicate: true }
      wildcard = i
      continue
    }
    const name = column.as || column.ref?.at(-1)?.id || column.ref?.at(-1) || column.func || column.val
    if (!byName.has(name)) byName.set(name, column)
    if (wildcard === -1) exclude.set(name, column)
    else replace.set(name, column)
  }
  return { columns, byName, wildcard, exclude, replace }
}

function planFor(ctx, owner, prop = 'columns') {
  const plans = ctx.projectionPlans || (ctx.projectionPlans = new WeakMap())
  let plan = plans.get(owner)
  if (!plan) {
    const columns = prop === 'columns' ? owner[prop] : cloneCqn(owner[prop])
    plans.set(owner, (plan = projectionPlan(columns, owner.excluding)))
  }
  return plan
}

function indexColumns(columns = []) {
  if (columns instanceof Map) return columns
  return new Map(columns.map(column => [column.as || column.ref?.at(-1) || column, column]))
}

module.exports = { projectionPlan, planFor, indexColumns, validateSelfDependencies, qualifyNestedColumn }

function validateSelfDependencies(plan, sources) {
  const complete = new Set(),
    visiting = new Set(),
    path = [],
    ordered = []
  for (const name of plan.byName.keys()) visit(name)
  return ordered
  function visit(name) {
    if (complete.has(name) || !plan.byName.has(name)) return
    if (visiting.has(name)) throw new Error('Cyclic $self reference: ' + [...path, name].join(' -> '))
    visiting.add(name)
    path.push(name)
    walk(plan.byName.get(name))
    path.pop()
    visiting.delete(name)
    complete.add(name)
    ordered.push(plan.byName.get(name))
  }
  function walk(token) {
    if (!token || typeof token !== 'object' || token.SELECT) return
    if (token.ref?.length > 1 && ['$self', '$projection'].includes(token.ref[0]) && !(token.ref[0] in sources)) {
      if (token.as || token !== plan.byName.get(token.ref[1])) visit(token.ref[1])
    }
    forEachChild(token, walk)
  }
}

// Qualify the already-bound occurrence in its plan, retaining its calculation
// identity. The original nested syntax remains intact for the infer facade.
function qualifyNestedColumn(column, parent) {
  if (column === '*') return
  if (column.ref && parent.ref) {
    column.ref = [...parent.ref, ...column.ref]
    defineProperty(column, '$refLinks', [...parent.$refLinks, ...column.$refLinks])
    defineProperty(column, 'isJoinRelevant', column.isJoinRelevant || parent.isJoinRelevant)
    defineProperty(column, 'flatName', [parent.flatName, column.flatName].filter(Boolean).join('_'))
  } else {
    forEachChild(column, token => qualifyNestedColumn(token, parent))
  }
}
