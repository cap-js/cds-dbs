'use strict'

// Complete enum values and casts on bound expressions when type resolution is needed.
// Track whether filters and grouping require localized data for count queries.

function complete(scope) {
  if (!scope.needsMetadata && !scope.localized) return
  const model = scope.model
  const seen = new WeakSet()
  const definition = node => node?.leaf?.enum ? node.leaf : node?.element?.enum ? node.element :
    model.definition(node?.syntax?.cast?.type) || (node?.xpr?.length === 1 && definition(node.xpr[0]))
  function walk(node, inherited) {
    if (!node || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    const local = definition(node)
    const type = node.syntax?.cast && model.definition(node.syntax.cast.type)
    if (node.syntax?.cast) node.cast = { ...node.syntax.cast, type: type?.enum ? type.type : node.element?.type || node.syntax.cast.type }
    if (node.syntax && '#' in node.syntax) {
      const symbol = node.syntax['#'], enumeration = (local || inherited)?.enum
      if (!enumeration) throw new Error('Can\'t resolve enum value "#' + symbol + '"')
      if (!(symbol in enumeration)) throw new Error('Unknown enum symbol "#' + symbol + '"')
      node.value = Object.hasOwn(node.syntax, 'val') ? node.syntax.val : enumeration[symbol].val ?? symbol
      node.kind = 'enum'
    }
    if (node.calculation) walk(node.calculation, local || inherited)
    if (node.kind === 'shape') visit(node.columns)
    if (node.xpr) visit(node.xpr, local || inherited)
    if (node.list) visit(node.list, local || inherited)
    if (node.args) for (const arg of Object.values(node.args)) Array.isArray(arg) ? visit(arg, local || inherited) : walk(arg, local || inherited)
  }
  function visit(tokens, inherited) {
    const candidates = tokens.map(definition)
    for (let i = 0; i < tokens.length; i++) {
      let found = candidates[i] || candidates[i - 2] || candidates[i + 2] || inherited
      if (!found && tokens.includes('case')) found = candidates.find(candidate => candidate?.enum)
      walk(tokens[i], found)
    }
  }
  for (const prop of ['projections', 'where', 'having', 'groupBy', 'orderBy']) visit(scope[prop] || [])
  visit(scope.from.filter || [])
  for (const join of scope.joins) { visit(join.on || []); visit(join.filter || []) }
  if (scope.with) for (const value of Object.values(scope.with)) walk(value)

  function localized(node) {
    if (!node || typeof node !== 'object') return false
    if (Array.isArray(node)) return node.some(localized)
    if (node.leaf?.localized && node.source?.scope.localized) return true
    if (node.kind === 'query') return node.query.localizedCountRelevant
    return localized(node.xpr) || localized(node.list) || localized(node.args && Object.values(node.args)) || localized(node.calculation)
  }
  scope.localizedCountRelevant = scope.localized && (
    localized(scope.where) || localized(scope.having) || localized(scope.groupBy) || localized(scope.from.filter) ||
    scope.joins.some(join => localized(join.filter)))
}

module.exports = complete
