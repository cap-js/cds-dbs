'use strict'

// Bind reference paths and calculated expressions to sources and model elements.
// Record association traversals and derive physical column locations from completed bindings.

const { id } = require('./syntax')
const { calculated, typeFor } = require('./model')
const { pseudos } = require('../infer/pseudos')

function reference(scope, syntax, context = {}) {
  if (syntax.cast) scope.needsMetadata = true
  const ref = syntax.ref
  let path = ref, source, prefix = []
  const head = id(ref[0])
  if (syntax.param || head in pseudos.elements) {
    let element = pseudos.elements[head]
    for (const step of ref.slice(1)) element = element?.elements?.[id(step)]
    if (head === '$user' && ref.length === 1) element = pseudos.elements.$user.elements.id
    return { kind: 'opaque', syntax, element: typeFor(syntax, element) }
  }
  if (context.clause === 'orderBy' && scope.byName.has(head)) {
    const projection = scope.compiler.projection(scope, head)
    if (!projection.expand && !(projection.wildcard && ref.length > 1 && projection.element?.target)) {
      const rest = ref.slice(1).map(id)
      const matching = projection.output.filter(column => {
        const path = [...(column.path?.slice(projection.bound.path?.length || 0) || []), ...(column.suffix?.path || [])].map(id)
        return !rest.length || rest.every((name, i) => name === path[i])
      })
      if (!matching.length && rest.length) throw new Error(projection.element?.target
        ? 'Can follow managed association “' + head + '” only to the keys of its target, not to “' + rest[0] + '”'
        : '"' + rest[0] + '" not found in "' + head + '"')
      if (matching.length > 1) throw new Error('Structured element “' + head + '” expands to multiple fields and can\'t be used in order by')
      return { kind: 'alias', syntax, projection, skip: projection.bound.skip, localized: scope.localized, selected: matching[0], element: matching[0]?.element || projection.element, name: matching[0]?.name || head }
    }
  }
  if (!context.on && !context.filter && scope.source(head) && (ref.length > 1 || syntax.inline || syntax.expand)) {
    source = scope.source(head)
    path = ref.slice(1)
  } else if (ref.length > 1 && ['$self', '$projection'].includes(head)) {
    const name = id(ref[1])
    let owner = scope
    while (owner && !scope.compiler.projection(owner, name)) owner = owner.parent
    const projection = owner && scope.compiler.projection(owner, name)
    if (!projection) {
      const candidates = [...scope.sources.values()].filter(source => source.definition.elements[name]).map(source => '"' + source.alias + '.' + name + '"')
      throw new Error('"' + name + '" not found in the columns list of query' + (candidates.length ? ', did you mean ' + candidates.join(', ') + '?' : ''))
    }
    if (projection.element?.target) throw new Error('Paths starting with “$self” must not contain steps of type “cds.Association”: ref: [ ' + ref.map(id).join(', ') + ' ]')
    const rest = ref.slice(2).map(id)
    let target = projection.element
    for (const step of rest) {
      target = target?.elements?.[step]
      if (target?.target) throw new Error('Paths starting with “$self” must not contain steps of type “cds.Association”: ref: [ ' + ref.map(id).join(', ') + ' ]')
    }
    if (scope.semanticOnly && rest.length) return { kind: 'self', syntax, projection, element: target, name: syntax.as || ref.slice(1).map(id).join('_') }
    const selected = projection.output.find(column => !rest.length || rest.every((step, i) => step === column.suffix?.path[i]))
    if (!selected && rest.length) throw new Error('"' + rest[0] + '" not found in "' + name + '"')
    return { kind: 'self', syntax, projection, selected, element: rest.length ? selected.element : projection.element, name: syntax.as || ref.slice(1).map(id).join('_') }
  } else if (head === '$main' && ref.length > 1) {
    let root = scope
    while (root.parent) root = root.parent
    source = root.sources.values().next().value
    path = ref.slice(1)
  } else if (context.base) {
    source = context.base.source
    prefix = context.base.path || []
  }
  source ||= scope.lookup(id(path[0]))
  const userPath = path
  path = [...prefix, ...path]
  const steps = []
  let definition = source.definition, owner = source, names = []
  for (let i = 0; i < path.length; i++) {
    const step = path[i], name = id(step)
    const element = definition.elements?.[name]
    if (!element) {
      const label = context.filter || ((name in pseudos.elements && steps.at(-1)?.name) || (definition.elements && definition.kind !== 'entity' && scope.semanticOnly && i ? source.definition.name + ':' + path.slice(0, i).map(id).join('.') : definition.name) || source.alias)
      throw new Error('"' + name + '" not found in "' + label + '"')
    }
    if (step.where && !element.target) throw new Error('A filter can only be provided when navigating along associations')
    names.push(name)
    const entry = { element, step, name }
    steps.push(entry)
    if (element.target) {
      definition = scope.model.target(element, scope.localized)
      const rest = path.slice(i + 1).map(id)
      const pairs = !scope.semanticOnly || context.restrict ? scope.model.keyPairs(element) : []
      const fk = !path.slice(i).some(step => step.where || step.args) && !element.on && pairs.some(pair =>
        rest.length <= pair.path.length && rest.every((s, j) => s === pair.path[j]))
      if (context.restrict && rest.length && !fk) throw new Error('Only foreign keys of “' + name + '” can be accessed in infix filter, but found “' + rest[0] + '”')
      if (scope.semanticOnly && step.where) {
        if (!rest.length && !syntax.expand && !context.exists) throw new Error('A filter can only be provided when navigating along associations')
        scope.compiler.expression(scope, { xpr: step.where }, { base: { source: { definition, scope }, path: [] }, filter: name, restrict: !context.exists && !syntax.expand })
      }
      if (rest.length && !scope.semanticOnly) {
        const join = scope.join(owner, element, names.join('_'), step)
        entry.join = join
        entry.useJoin = !fk
        owner = join
        names = []
      }
      if (!scope.semanticOnly && (rest.length || (!context.projection && i > 0)) && !scope.model.keys(element)?.length && !element.on)
        throw new Error('Path step “' + name + '” of “' + path.map(s => id(s) + (s.where ? '[…]' : '')).join('.') + '” has no foreign keys')
    } else definition = element
  }
  const element = steps.at(-1)?.element || source.definition
  const binding = { kind: 'ref', syntax, source, path, steps, element: typeFor(syntax, element),
    leaf: element, physicalPrefix: context.physicalPrefix, name: syntax.as || userPath.map(id).join('_') }
  // Draft elements can remain virtual while carrying a compiler-provided calculation.
  binding.skip = steps.some(step => (step.element.virtual && !calculated(step.element)) || !scope.model.persisted(step.element))
  if (!context.deferJoins && (!binding.skip || (!context.projection && !['groupBy', 'orderBy'].includes(context.clause)))) {
    if (steps.some(step => step.useJoin)) for (const step of steps) if (step.join)
      step.join.order ??= scope.joinOrder = (scope.joinOrder || 0) + 1
    for (const step of steps) if (step.useJoin) scope.require(step.join)
  }
  if (calculated(element) && !(source.query && !steps.some(step => step.element.target))) {
    const key = element
    const active = scope.activeCalculations || (scope.activeCalculations = new Set())
    if (active.has(key)) throw new Error('Cyclic calculated element: ' + element.name)
    active.add(key)
    try {
      const lastJoin = steps.findLastIndex(step => step.useJoin)
      binding.calculation = scope.compiler.expression(scope, element.value, {
        ...context, base: { source: lastJoin < 0 ? source : steps[lastJoin].join, path: path.slice(lastJoin + 1, -1) },
      })
    } finally { active.delete(key) }
  }
  return binding
}

// Resolve physical names only after every path has contributed its join needs.
// This reads completed binding records; it never looks up a model reference.
function location(binding, leaf) {
  let source = binding.source, names = []
  const steps = binding.steps
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    if (step.useJoin || (source !== binding.source && step.join?.required)) {
      source = step.join
      names = []
    } else {
      names.push(step.name)
      if (step.element.target) {
        const remaining = [...steps.slice(i + 1).map(s => s.name), ...(leaf?.path || [])]
        const pair = binding.source.scope.model.keyPairs(step.element).find(pair => pair.path.length === remaining.length && pair.path.every((s, j) => s === remaining[j]))
        if (pair) return { source, name: [binding.physicalPrefix, ...names, pair.source].filter(Boolean).join('_') }
      }
    }
  }
  if (leaf?.name) names.push(leaf.name)
  return { source, name: [binding.physicalPrefix, ...names].filter(Boolean).join('_') }
}

module.exports = { reference, location }
