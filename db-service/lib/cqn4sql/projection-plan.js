'use strict'

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
  if (!plan) plans.set(owner, (plan = projectionPlan(owner[prop], owner.excluding)))
  return plan
}

function indexColumns(columns = []) {
  if (columns instanceof Map) return columns
  return new Map(columns.map(column => [column.as || column.ref?.at(-1) || column, column]))
}

module.exports = { projectionPlan, planFor, indexColumns, validateSelfDependencies }

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
    for (const child of token.xpr || token.list || Object.values(token.args || {})) walk(child)
  }
}
