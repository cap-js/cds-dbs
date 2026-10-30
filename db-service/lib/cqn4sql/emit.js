'use strict'

// Emit fresh SQL-shaped CQN from completed plans, including joins, expands and writes.
// Use finalized aliases and bindings without resolving model names or discovering joins.

const { shell, copy, hidden, and, prototype } = require('./syntax')

function emit(plan) {
  if (plan.phase !== 'planned') throw new Error('Cannot emit an unfinished query plan')
  if (plan.semanticOnly) return require('./logical').emit(plan)
  const properties = shell(plan.syntax, [plan.kind])
  Object.setPrototypeOf(properties, prototype(plan.syntax))
  const result = Object.create(properties)
  const passthrough = shell(plan.clause, ['from', 'into', 'entity', 'columns', 'where', 'having', 'groupBy', 'orderBy', 'with'])
  const clause = result[plan.kind] = Object.create(copy(passthrough, new WeakMap(), true))
  let from = emitSource(plan.from)
  for (const join of plan.joins) if (join.required) {
    from = { join: 'left', args: [from, emitSource(join)], on: and(tokens(join.on), tokens(join.filter)) }
  }
  const sourceProperty = plan.clause.into ? 'into' : plan.clause.from ? 'from' : 'entity'
  clause[sourceProperty] = from
  if (plan.kind === 'INSERT' || plan.kind === 'UPSERT') {
    clause.into = { ref: [plan.target.name] }
    if (plan.clause.into.as) clause.into.as = plan.clause.into.as
    if (plan.clause.columns) clause.columns = copy(plan.clause.columns)
    if (plan.clause.from) clause.from = copy(plan.clause.from)
  }
  if (plan.kind === 'SELECT') clause.columns = plan.projections.map(column => node(column, column.outputColumn !== false))
  for (const prop of ['where', 'having', 'groupBy', 'orderBy']) {
    let value = tokens(plan[prop])
    if (prop === 'where') {
      if (plan.correlation) value = and(tokens(plan.correlation), tokens(plan.from.filter), tokens(plan.navigation), value)
      else {
        value = and(tokens(plan.from.filter), value)
        value = and(tokens(plan.navigation), plan.navigation && value.some(token => token === 'and' || token === 'or') ? [{ xpr: value }] : value)
      }
    }
    if (value?.length) clause[prop] = value
  }
  if (plan.with) clause.with = Object.fromEntries(Object.entries(plan.with).map(([key, value]) => [key, node(value)]))
  if (plan.clause.limit) clause.limit = copy(plan.clause.limit)
  if (plan.writeSelection) {
    clause[sourceProperty] = emitSource(plan.writeSource)
    clause.where = [{ list: plan.writeKeys.map(key => node(key)) }, 'in', emit(plan.writeSelection)]
  }
  hidden(result, '_target', plan.target || result)
  hidden(result, 'elements', plan.elements)
  if (plan.localizedCountRelevant) hidden(clause, 'localizedCountRelevant', true)
  if (plan.expand) {
    hidden(clause, 'expand', true)
    hidden(clause, 'one', plan.one)
  }
  return result
}

function emitSource(source) {
  if (source.query) { const result = emit(source.query); result.as = source.alias; return result }
  if (source.args && !source.definition) return { ...shell(source.syntax), args: source.args.map(emitSource) }
  const args = source.args || source.step?.args || (source.definition.params || source.definition['@cds.persistence.udf'] ? {} : undefined)
  const name = source.runtimeView?.alias || source.definition.name
  return { ref: [args ? { id: name, args: copy(args) } : name], as: source.alias }
}

function tokens(input) { return input?.map(value => node(value)) }

function node(bound, projection = false) {
  if (!bound || typeof bound !== 'object') return bound
  const syntax = bound.syntax || {}
  const properties = bound.generated ? {} : shell(syntax, ['ref', 'xpr', 'args', 'list', 'SELECT', 'expand', 'inline', 'excluding'])
  // CDS query helpers identify plain queries by their first own property.
  const result = bound.kind === 'query' || bound.kind === 'shape'
    ? Object.defineProperties({ SELECT: undefined }, Object.getOwnPropertyDescriptors(properties)) : properties
  if (!projection) delete result.as
  if (result.implicit !== undefined) hidden(result, 'implicit', result.implicit)
  if (bound.kind === 'column') {
    const column = { ref: [bound.source.alias, bound.name] }
    if (bound.element) hidden(column, 'element', bound.element)
    return column
  }
  if (bound.kind === 'ref') {
    if (bound.calculation) {
      const expression = node(bound.calculation)
      Object.assign(result, expression)
    } else {
      const place = bound.place
      result.ref = [place.source.alias, place.name]
    }
  } else if (bound.kind === 'self') {
    const original = bound.selected || bound.projection.output[0]
    Object.assign(result, node(original))
  } else if (bound.kind === 'alias') {
    if (bound.localized && bound.element.type === 'cds.String') {
      Object.assign(result, node(bound.selected || bound.projection.output[0]))
      delete result.cast
    }
    else result.ref = [bound.name]
  } else if (bound.kind === 'opaque') Object.assign(result, copy(syntax))
  else if (bound.kind === 'enum') {
    delete result['#']
    result.val = bound.value
  }
  else if (bound.kind === 'shape') {
    const SELECT = result.SELECT = { from: null, columns: bound.columns.map(column => node(column, true)) }
    hidden(SELECT, 'expand', true)
    hidden(SELECT, 'one', bound.one)
    hidden(result, 'elements', bound.elements)
    result.as = bound.name
  }
  else if (bound.kind === 'query') {
    if (bound.expand) for (const prop of ['where', 'having', 'groupBy', 'orderBy', 'limit', 'excluding', 'count']) delete result[prop]
    const query = emit(bound.query)
    Object.assign(result, query)
    hidden(result, 'elements', query.elements)
    hidden(result, '_target', query._target)
    if (projection) result.as = bound.name || syntax.as
    if (bound.expand) hidden(result, 'elements', bound.query.elements)
  } else {
    if (bound.xpr) result.xpr = tokens(bound.xpr)
    if (bound.list) result.list = tokens(bound.list)
    if (bound.args) result.args = Array.isArray(bound.args) ? bound.args.map(arg => node(arg)) :
      Object.fromEntries(Object.entries(bound.args).map(([key, value]) => [key, Array.isArray(value) ? tokens(value) : node(value)]))
  }
  if (projection && bound.kind !== 'query' && bound.kind !== 'opaque') {
    if (bound.forceAlias || syntax.as || syntax.cast || (!('val' in syntax) && (!result.ref || result.ref.at(-1) !== bound.name))) result.as = bound.name
    else delete result.as
  }
  if (bound.element) hidden(result, 'element', bound.element)
  if (bound.omitAlias) delete result.as
  if (bound.cast) result.cast = bound.cast
  return result
}

module.exports = emit
