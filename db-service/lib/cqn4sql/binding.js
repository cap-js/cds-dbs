'use strict'

const { getFullName } = require('./helpers')

/**
 * A bound reference belongs to one query occurrence. Its links pair each ref
 * step with a read-only CSN definition and the scope where that step resolves.
 * Association links are shared with the prefix join trie; their alias and
 * onlyForeignKeyAccess fields are finalized during planning.
 *
 * Emission retains links (not copied aliases) and caches path facts separately
 * from CQN. Calculated expressions have independent bindings for each access
 * path, including filters and parameters. Nothing is attached to the CSN.
 */
function bindingFor(ctx, node) {
  const cache = ctx.bindings || (ctx.bindings = new WeakMap())
  let binding = cache.get(node)
  if (binding) return binding
  const links = node.$refLinks
  const leaf = links.at(-1).definition
  let join,
    association,
    foreignKeyIndex = -1
  for (let i = 0; i < links.length; i++) {
    const link = links[i]
    if (!link.definition.isAssociation) continue
    association = link
    if (!link.onlyForeignKeyAccess) join = link
    else if (foreignKeyIndex === -1) foreignKeyIndex = i
  }
  binding = {
    source: links[0],
    leaf,
    join,
    association,
    foreignKeyIndex,
    columnName: foreignKeyIndex === -1 ? getFullName(leaf) : node.ref.slice(foreignKeyIndex).join('_'),
  }
  cache.set(node, binding)
  return binding
}

module.exports = { bindingFor }
