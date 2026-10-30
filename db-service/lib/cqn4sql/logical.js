'use strict'

const cds = require('@sap/cds')
const { copy, hidden } = require('./syntax')

function project(scope, record, context) {
  const { syntax, bound, name } = record
  if (!syntax.as && (syntax.xpr || syntax.SELECT)) throw new Error('Expecting expression to have an alias name')
  let element = context.rawExpressions && !syntax.ref ? copy(syntax) : bound.element
  let output
  const nested = syntax.expand || syntax.inline
  if (nested) {
    if (syntax.ref && !bound.leaf?.elements && !bound.leaf?.target)
      throw new Error('Unexpected “' + (syntax.expand ? 'expand' : 'inline') + '” on “' + name + '”; can only be used after a reference to a structure, association or table alias')
    const base = syntax.ref ? { source: bound.source, path: bound.path } : context.base
    const children = require('./projections').columns(scope, nested, { base, nested: true, excluding: syntax.excluding || [],
      label: (syntax.expand ? 'expand' : 'inline') + ' of "' + name + '"', rawExpressions: !syntax.ref || bound.leaf?.kind === 'entity' })
    const elements = Object.fromEntries(children.map(column => [column.name, column.element]))
    if (children.length !== Object.keys(elements).length) throw new Error('Duplicate definition of element')
    if (syntax.inline) output = children.map(column => ({ ...column, name: bound.leaf?.kind === 'entity' ? column.name : name + '_' + column.name }))
    const struct = new cds.struct({ elements })
    element = bound.leaf?.cardinality?.max === '*' && syntax.expand ? new cds.array({ items: struct }) : struct
  }
  const additions = Object.fromEntries(Object.entries(syntax).filter(([key]) => key === 'key' || key.startsWith('@')))
  if (Object.keys(additions).length) element = Object.assign(Object.create(Object.getPrototypeOf(element)), element, additions)
  if (syntax.as && bound.leaf && element.name !== syntax.as) {
    element = Object.assign(Object.create(Object.getPrototypeOf(element)), element)
    hidden(element, 'name', syntax.as)
  }
  if (syntax.as && !bound.leaf && !Object.hasOwn(element, 'as')) hidden(element, 'as', syntax.as)
  record.element = element
  scope.columnMetadata.set(syntax, element)
  output ||= [{ ...bound, element, name }]
  if (!context.base && !context.nested) for (const column of output) scope.elements[column.name] = column.element
  return output
}

function emit(plan) {
  const seen = new WeakMap()
  const result = copy(plan.syntax, seen, true)
  function decorate(scope, output) {
    if (scope.viewDefinition && scope.custom) for (const source of scope.sources.values()) {
      const from = seen.get(source.syntax)
      from.as ||= source.alias
    }
    for (const source of scope.sources.values()) if (source.runtimeView) {
      const from = seen.get(source.syntax)
      from.ref = [source.runtimeView.alias]
      from.as ||= source.alias
    }
    for (const [syntax, child] of scope.subqueries) decorate(child, seen.get(syntax))
    for (const [syntax, element] of scope.columnMetadata) {
      const column = seen.get(syntax)
      if (column) hidden(column, 'element', element)
    }
    const sources = Object.fromEntries([...scope.sources].map(([alias, source]) => [alias, {
      definition: source.query ? seen.get(source.syntax) : source.definition,
      ...(source.args ? { args: source.args } : {}),
    }]))
    hidden(output, 'sources', sources)
    hidden(output, '_target', scope.sources.size === 1 ? Object.values(sources)[0].definition : output)
    hidden(output, 'elements', scope.elements)
  }
  decorate(plan, result)
  return result
}

module.exports = { project, emit }
