'use strict'

module.exports = { resolveSources, combineElements, elementSources }

const referencesModule = require('./references')

const cds = require('@sap/cds')
const { resolveQuery } = require('../resolve')
const JoinTree = require('../join-tree')
const { getImplicitAlias } = require('../../utils')

/**
 * Infers all query sources from a given SQL-like query's `from` clause.
 * It drills down into join arguments of the `from` clause.
 *
 * This function helps identify each source, target, and association within the `from` clause.
 * It processes the `from` clause in the query and maps each source to a respective target and alias.
 * In case of any errors like missing definitions or associations, this function will throw an error.
 *
 * @function resolveSources
 * @param {object|string} from - The `from` clause of the query to infer the target from.
 *                              It could be an object or a string.
 * @param {object} querySources - An object to map the query sources.
 *                              Each key is a query source alias, and its value is the corresponding CSN Definition.
 * @returns {object} The updated `querySources` object with inferred sources from the `from` clause.
 */
function resolveSources(ctx, from, querySources, useTechnicalAlias) {
  const { ref } = from
  // Given a from clause `Root:parent[$main.name = name].parent as Foo`
  // we need to first resolve until to the last step of the from.ref
  // before we can replace $main with `Foo`
  const $mainLazyResolve = [] // TODO: remove and replace with real alias breakout
  if (ref) {
    const { id, args } = ref[0]
    const first = id || ref[0]
    let target = ctx.getDefinition(first) || cds.error`"${first}" not found in the definitions of your model`
    if (!target) throw new Error(`"${first}" not found in the definitions of your model`)
    if (ref.length > 1) {
      target = from.ref.slice(1).reduce((d, r) => {
        const next = ctx.getDefinition(d.elements[r.id || r]?.target) || d.elements[r.id || r]
        if (!next) throw new Error(`No association “${r.id || r}” in ${d.kind} “${d.name}”`)
        return next
      }, target)
    }
    if (target.kind !== 'entity' && !target.isAssociation)
      throw new Error('Query source must be a an entity or an association')

    referencesModule.resolveExpression(ctx, from, null, null, { inFrom: true, $mainLazyResolve })
    const alias =
      from.uniqueSubqueryAlias ||
      from.as ||
      (ref.length === 1
        ? getImplicitAlias(first, useTechnicalAlias)
        : getImplicitAlias(ref.at(-1).id || ref.at(-1), useTechnicalAlias))
    if (alias in querySources) throw new Error(`Duplicate alias "${alias}"`)
    querySources[alias] = { definition: ctx.getDefinition(target.name), args }
    const last = from.$refLinks.at(-1)
    last.alias = alias
  } else if (from.args) {
    from.args.forEach(a => resolveSources(ctx, a, querySources, false))
  } else if (from.SELECT) {
    const subqueryInFrom = resolveQuery(ctx, from, ctx.model) // we need the .elements in the sources
    // if no explicit alias is provided, we make up one
    const cachedAlias = ctx.state.sourceAliases.get(from)
    const available =
      cachedAlias && !ctx.query.outerQueries?.some(q => q.joinTree._queryAliases.has(cachedAlias.toUpperCase()))
    const subqueryAlias =
      from.as ||
      (available && cachedAlias) ||
      subqueryInFrom.joinTree.addNextAvailableTableAlias(
        '__select__',
        subqueryInFrom.outerQueries || ctx.query.outerQueries,
      )
    ctx.state.sourceAliases.set(from, subqueryAlias)
    querySources[subqueryAlias] = { definition: from }
  } else if (typeof from === 'string') {
    // TODO: Create unique alias, what about duplicates?
    const definition = ctx.getDefinition(from) || cds.error`"${from}" not found in the definitions of your model`
    querySources[getImplicitAlias(from, useTechnicalAlias)] = { definition }
  } else if (from.SET) {
    resolveQuery(ctx, from, ctx.model)
  }

  const joinTree = new JoinTree(querySources, ctx.state.metadata)
  Object.defineProperty(ctx.query, 'joinTree', { value: joinTree, writable: true, configurable: true })
  for (const lazyRef of $mainLazyResolve) referencesModule.resolveExpression(ctx, lazyRef)
  return querySources
}

/**
 * Calculates the `$combinedElements` based on the provided queries `sources`.
 * The `$combinedElements` of a query consist of all accessible elements across all
 * the table aliases found in the from clause.
 *
 * The `$combinedElements` are attached to the query as a non-enumerable property.
 * Each entry in the `$combinedElements` dictionary maps from the element name
 * to an array of objects containing the index and table alias where the element can be found.
 *
 * @returns {object} The `$combinedElements` dictionary, which maps element names to an array of objects
 *                   containing the index and table alias where the element can be found.
 */
function combineElements(ctx) {
  const combinedElements = {}
  for (const index in ctx.sources) {
    const tableAlias = ctx.sources[index].definition
    for (const key in tableAlias.elements) {
      if (key in combinedElements) combinedElements[key].push({ index, tableAlias })
      else combinedElements[key] = [{ index, tableAlias }]
    }
  }
  return combinedElements
}

// Single-source references need no dictionary combining every model element.
// The full dictionary is materialized only for wildcard/ambiguous projections.
function elementSources(query, name) {
  const aliases = Object.keys(query.sources)
  if (aliases.length !== 1) return query.$combinedElements[name]
  const index = aliases[0]
  const tableAlias = query.sources[index].definition
  return name in tableAlias.elements ? [{ index, tableAlias }] : undefined
}
