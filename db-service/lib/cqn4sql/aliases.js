'use strict'

const { location } = require('./bind')

// Bindings retain source identities. Allocate names after the whole scope is
// known, so a later outer join cannot be shadowed by an earlier nested query.
function allocate(root) {
  const completed = new Set()
  function scope(plan, outer = new Set(), reserved, generated) {
    if (completed.has(plan)) return
    completed.add(plan)
    if (plan.semanticOnly) return
    const used = new Set(outer), family = generated || new Set(), suffixes = new Map()
    function name(requested, registry = used) {
      const upper = requested.toUpperCase()
      let result = requested
      if (registry.has(upper)) {
        let suffix = suffixes.get(upper) || 2
        while (registry.has(upper + suffix)) suffix++
        result += suffix
        suffixes.set(upper, suffix + 1)
      }
      registry.add(result.toUpperCase())
      return result
    }
    for (const source of plan.sources.values()) {
      source.alias = reserved || (source.explicit ? source.requested : name(source.requested))
      used.add(source.alias.toUpperCase())
    }
    const joins = []
    function branches(source) {
      for (const child of [...source.children.values()].filter(child => child.order).sort((a, b) => a.order - b.order)) {
        child.alias = name(child.preferred)
        if (child.required) joins.push(child)
        branches(child)
      }
    }
    for (const source of plan.sources.values()) branches(source)
    plan.joins = joins
    if (plan.writeSelection) {
      plan.writeSource.alias = name(plan.from.requested)
      plan.writeSelection.joins = joins
    }
    const visited = new WeakSet()
    function query(child) {
      if (completed.has(child)) return
      const source = child.sources.size === 1 && child.sources.values().next().value
      if (source?.syntax?.$generatedAlias) {
        for (const alias of used) family.add(alias)
        const alias = name(source.requested, family)
        scope(child, new Set([...used, ...family]), alias, family)
        used.add(alias.toUpperCase())
      } else scope(child, used)
    }
    function walk(node) {
      if (!node || typeof node !== 'object' || visited.has(node)) return
      visited.add(node)
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (node.kind === 'query') { query(node.query); return }
      if (node.kind === 'ref' && !node.calculation) {
        const place = node.place = location(node, node.suffix)
        if (node.outputColumn && node.leaf.target) node.element = place.source.definition.elements[place.name] || node.element
        return
      }
      if (node.calculation) walk(node.calculation)
      if (node.kind === 'shape') walk(node.columns)
      if (node.kind === 'self') walk(node.selected || node.projection.output)
      walk(node.xpr); walk(node.list)
      if (node.args) Object.values(node.args).forEach(walk)
    }
    walk(plan.where)
    walk(plan.from.filter)
    walk(plan.navigation)
    for (const source of plan.sources.values()) if (source.query) query(source.query)
    walk(plan.projections)
    walk(plan.having); walk(plan.groupBy); walk(plan.orderBy)
    walk(plan.correlation)
    if (plan.with) Object.values(plan.with).forEach(walk)
    for (const join of joins) { walk(join.on); walk(join.filter) }
  }
  scope(root)
  return root
}

module.exports = allocate
