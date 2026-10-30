'use strict'

// Plan ordered SELECT columns, wildcard replacements, exclusions and result elements.
// Resolve projection dependencies and flatten inline columns or plan nested expands.

const cds = require('@sap/cds')
const { reference } = require('./bind')
const { id, nameOf } = require('./syntax')
const { typeFor, entries, calculated } = require('./model')

function columns(scope, syntax = scope.clause.columns || ['*'], context = {}) {
  const excluding = new Set(context.excluding || scope.clause.excluding || [])
  const explicit = new Map()
  const anonymous = new Map(syntax.map((column, index) => [column, 'expr' + index]))
  const name = column => {
    if (!column.ref) return column.xpr && !column.as ? anonymous.get(column) : nameOf(column)
    const path = column.ref.length > 1 && (scope.source(id(column.ref[0])) || id(column.ref[0]) === '$main') ? column.ref.slice(1) : column.ref
    return column.as || path.map(id).join('_')
  }
  for (const column of syntax) {
    if (column === '*') continue
    if (column.inline) continue
    const key = name(column)
    if (explicit.has(key)) throw new Error('Duplicate definition of element “' + key + '”')
    explicit.set(key, column)
  }
  const ordered = []
  const placedNames = new Set(), placedSyntax = new Set()
  const add = record => { ordered.push(record); placedNames.add(record.name); placedSyntax.add(record.syntax) }
  let wildcard = false
  for (const column of syntax) {
    if (column !== '*') {
      if (!wildcard || !placedSyntax.has(column)) add({ syntax: column, name: name(column), key: column.inline ? Symbol(name(column)) : name(column) })
      continue
    }
    if (wildcard) throw new Error('Duplicate wildcard "*" in ' + (context.label || 'column list'))
    wildcard = true
    const definitions = context.base
      ? [{ source: context.base.source, definition: scope.model.at(context.base.source.definition, context.base.path) }]
      : [...scope.sources.values()].map(source => ({ source, definition: source.definition }))
    if (scope.semanticOnly && definitions.length > 1) {
      const names = new Map()
      for (const { source, definition } of definitions) for (const key in definition.elements) {
        if (excluding.has(key) || explicit.has(key)) continue
        if (!names.has(key)) names.set(key, [])
        names.get(key).push('"' + source.alias + '.' + key + '"')
      }
      const ambiguous = [...names].filter(([, aliases]) => aliases.length > 1)
      if (ambiguous.length) throw new Error('Ambiguous wildcard elements:' + ambiguous.map(([key, aliases]) => '\n       select "' + key + '" explicitly with ' + aliases.join(', ')).join(''))
    }
    for (const { source, definition } of definitions) {
      for (const [key, element] of entries(scope.model.target(definition).elements || {})) {
        if (excluding.has(key) || placedNames.has(key)) continue
        if (!context.base && !context.nested && (element.type === 'cds.LargeBinary' || element.type === 'cds.Vector')) continue
        const omitProjection = !scope.semanticOnly && element.target && (scope.model.csn.meta?.transformation === 'odata' || scope.model.csn.meta?.unfolded?.includes('structs'))
        const replacement = explicit.get(key)
        if (omitProjection && replacement) continue
        add({ syntax: replacement || { ref: context.base ? [key] : [source.alias, key] }, name: key, key, wildcard: true,
          generated: !replacement,
          known: !context.base && !replacement && !element.target && !element.elements && !calculated(element) ? { source, element } : undefined,
          omitProjection: omitProjection && !replacement })
      }
    }
  }
  if (!context.base && !context.prefix && !context.nested) {
    scope.inlineRecords = ordered.filter(record => record.syntax.inline)
    for (const record of ordered) scope.byName.set(record.key, record)
    for (const record of ordered) scope.compiler.projection(scope, record.key)
    const names = new Set()
    scope.projections = ordered.flatMap(record => record.output).filter(column => {
      if (names.has(column.name)) {
        if (scope.semanticOnly) throw new Error('Duplicate definition of element “' + column.name + '”')
        return false
      }
      names.add(column.name)
      return true
    })
    if (!scope.semanticOnly && !scope.projections.length && ordered.some(record => record.bound.skip || record.bound.leaf?.virtual)) throw new Error('Queries must have at least one non-virtual column')
    return scope.projections
  }
  return ordered.flatMap(record => project(scope, record, context))
}

function project(scope, record, context = {}) {
  if (record.output) return record.output
  // A scalar discovered by a root wildcard is already bound to its source.
  // It needs neither dependency resolution nor a reference-path allocation.
  if (record.known && !scope.semanticOnly && !context.base && !context.prefix) {
    const { element, source } = record.known
    record.element = element
    record.bound = { kind: 'column', source, name: record.name, element, leaf: element, skip: !!element.virtual }
    if (element.virtual) return record.output = []
    scope.elements[record.name] = element
    return record.output = [record.bound]
  }
  if (record.active) throw new Error('Cyclic $self reference: ' + [...scope.dependencies.keys(), record.name].join(' -> '))
  record.active = true
  scope.dependencies.set(record.name, record)
  try {
    const syntax = record.syntax
    const bound = record.known ? {
      kind: 'ref', syntax, source: record.known.source, path: [record.name],
      physicalPrefix: context.physicalPrefix,
      steps: [{ name: record.name, element: record.known.element }],
      element: record.known.element, leaf: record.known.element, skip: !!record.known.element.virtual, name: record.name,
    } : syntax.ref ? reference(scope, syntax, { ...context, projection: true, deferJoins: !!syntax.expand, inline: !!syntax.inline }) : scope.compiler.expression(scope, syntax, context)
    const tableInline = (syntax.inline || syntax.expand) && bound.leaf?.kind === 'entity'
    const prefix = tableInline ? context.prefix || '' : context.prefix ? context.prefix + '_' + record.name : record.name
    record.element = bound.element
    record.bound = bound
    bound.generated = record.generated
    if (scope.semanticOnly) return record.output = require('./logical').project(scope, record, context)
    if (record.omitProjection) {
      if (!context.base) scope.elements[record.name] = bound.element
      return record.output = []
    }
    const output = []
    if (bound.skip) return record.output = []
    const nested = syntax.inline || syntax.expand
    if (nested && bound.leaf?.target && syntax.expand) {
      if (scope.clause.groupBy) {
        const shape = grouped(scope, bound, syntax, prefix)
        record.expand = true
        if (shape) {
          record.element = shape.element
          output.push(shape)
        }
      } else {
        const query = scope.compiler.expand(scope, bound, syntax)
        record.expand = true
        record.element = Object.assign(Object.create(bound.element), { elements: query.elements })
        output.push({ kind: 'query', syntax, query, element: record.element, name: prefix, expand: true })
      }
    } else if (nested) {
      const base = syntax.ref ? { source: bound.source, path: bound.path } : context.base
      const nestedColumns = columns(scope, nested, { ...context, base, prefix, physicalPrefix: context.physicalPrefix || (!syntax.ref && nested.includes('*') && syntax.as), excluding: syntax.excluding || [] })
      output.push(...nestedColumns)
      record.element = Object.assign(Object.create(bound.element || cds.builtin.types.struct), { elements: {} })
      for (const column of nestedColumns) record.element.elements[column.name.slice(prefix.length + 1)] = column.element
    } else if (bound.kind === 'ref' && !bound.calculation) {
      if (!bound.leaf.target && (!bound.leaf.elements || bound.leaf.type === 'cds.Map')) {
        output.push({ ...bound, name: prefix, outputColumn: true,
          omitAlias: !!(record.wildcard && context.base?.path.at(-1)?.where && bound.leaf.key) })
      } else for (const leaf of scope.model.leaves(bound.leaf)) {
        if (record.wildcard && (context.excluding || scope.clause.excluding || []).includes([record.name, leaf.name].filter(Boolean).join('_'))) continue
        if (record.wildcard && !context.base && (leaf.element.type === 'cds.LargeBinary' || leaf.element.type === 'cds.Vector')) continue
        const columnName = [prefix, (syntax.as || bound.path.length > 1) ? leaf.alias ?? leaf.name : leaf.name].filter(Boolean).join('_')
        output.push({ ...bound, suffix: leaf, element: typeFor(syntax, leaf.element), name: columnName, outputColumn: true,
          omitAlias: !!(record.wildcard && context.base?.path.at(-1)?.where && bound.leaf.key) })
      }
    } else output.push({ ...bound, name: prefix, outputColumn: true })
    if (!context.base && !context.prefix) {
      if (syntax.inline) {
        for (const column of output) {
          scope.elements[column.name] = column.element
          scope.byName.set(column.name, { name: column.name, bound: column, output: [column], element: column.element })
        }
      } else scope.elements[record.name] = record.element
    }
    return record.output ||= output
  } finally {
    record.active = false
    scope.dependencies.delete(record.name)
  }
}

module.exports = { columns, project }

function grouped(scope, binding, syntax, name) {
  if (syntax.expand.includes('*')) return null
  const key = ref => JSON.stringify(ref.map(step => typeof step === 'object' ? [step.id, step.where, step.args] : step))
  const unqualified = ref => ref.length > 1 && scope.source(id(ref[0])) ? ref.slice(1) : ref
  const index = scope.groupingSyntax || (scope.groupingSyntax = new Map(scope.clause.groupBy.filter(column => column.ref).map(column => [key(unqualified(column.ref)), column])))
  const columns = [], elements = {}
  for (const column of syntax.expand) {
    if (column.expand?.includes('*')) continue
    if (!column.ref) {
      columns.push({ ...scope.compiler.expression(scope, column), name: nameOf(column), forceAlias: true })
      continue
    }
    const path = [...binding.path, ...column.ref]
    if (!column.expand && !index.has(key(path))) {
      const display = path.map(step => typeof step === 'object' ? step.id + (step.where ? '[' + JSON.stringify(step.where).slice(1, -1) + ']' : '') : step).join('.')
      throw new Error('The expanded column "' + display + '" must be part of the group by clause')
    }
    const bound = reference(scope, column, { base: { source: binding.source, path: binding.path } })
    const outputName = column.as || column.ref.map(id).join('_')
    if (column.expand) {
      const child = grouped(scope, bound, column, outputName)
      if (child) { columns.push(child); elements[outputName] = child.element }
    } else for (const leaf of scope.model.leaves(bound.leaf)) {
      const name = [outputName, leaf.name].filter(Boolean).join('_')
      columns.push({ ...bound, suffix: leaf, name, element: leaf.element, forceAlias: true })
      elements[name] = leaf.element
    }
  }
  if (!columns.length) return null
  const element = Object.assign(Object.create(binding.element), { elements })
  return { kind: 'shape', syntax, columns, name, elements, element, one: binding.leaf.cardinality?.max !== '*' }
}
