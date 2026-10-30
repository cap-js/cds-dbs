'use strict'

// Coordinate query planning across sources, projections, expressions and associations.
// Build nested scopes, navigation, expands and write selections, then complete their plans.

const Scope = require('./scope')
const { Model, fullName } = require('./model')
const { expression, stream } = require('./expressions')
const { columns, project } = require('./projections')
const { id, and, shell } = require('./syntax')
const associations = require('./associations')
const search = require('./search')
const complete = require('./metadata')

class Compiler {
  constructor(model, options) {
    this.options = options
    this.model = new Model(model, options)
    this.views = new Map()
    this.viewNames = new Set()
    this.viewOrder = []
  }

  expression(scope, syntax, context) { return expression(scope, syntax, context) }
  projection(scope, name) {
    if (!scope.byName.has(name)) for (const inline of scope.inlineRecords || []) if (!inline.active) project(scope, inline)
    const record = scope.byName.get(name)
    if (record) project(scope, record)
    return record
  }

  plan(syntax, parent) {
    const scope = new Scope(this, syntax, parent)
    let clause = scope.clause
    const modifiers = (clause.from || clause.entity)?.ref?.at(-1)
    if (modifiers && typeof modifiers === 'object') {
      clause = scope.clause = shell(clause)
      for (const prop of ['groupBy', 'orderBy']) if (modifiers[prop]) clause[prop] = [...(clause[prop] || []), ...modifiers[prop]]
      if (modifiers.having) clause.having = and(clause.having, modifiers.having)
      if (modifiers.limit && !clause.limit) clause.limit = modifiers.limit
    }
    scope.from = this.source(scope, clause.into || clause.from || clause.entity)
    scope.target = scope.sources.size === 1 ? scope.sources.values().next().value.definition : null
    if (scope.kind !== 'SELECT') scope.elements = scope.target?.elements
    if (scope.target?.['@cds.localized'] === false) scope.localized = false
    if (scope.kind === 'SELECT') columns(scope)
    if (scope.from.filterSyntax) scope.from.filter = this.filter(scope, scope.from, scope.from.filterSyntax)
    if (!scope.semanticOnly) search(scope)
    clause = scope.clause
    for (const property of ['where', 'having', 'groupBy', 'orderBy']) {
      scope[property] = stream(scope, clause[property], { clause: property })
      if (!scope.semanticOnly && (property === 'groupBy' || property === 'orderBy')) scope[property] = scope[property]?.flatMap(bound => {
        if (bound?.kind !== 'ref' || bound.calculation) return [bound]
        const leaves = this.model.leaves(bound.leaf)
        if (property === 'orderBy' && leaves.length > 1) throw new Error('Structured element “' + fullName(bound.leaf) + '” expands to multiple fields and can\'t be used in order by')
        return leaves.map(leaf => ({ ...bound, suffix: leaf, element: leaf.element }))
      })
    }
    if (clause.with) scope.with = Object.fromEntries(Object.entries(clause.with).map(([key, value]) => [key, expression(scope, value)]))
    for (let i = 0; i < scope.joins.length; i++) {
      const join = scope.joins[i]
      if (join.required) {
        join.on = this.condition(scope, join.association, join.parent, join, join.prefix, true)
        if (join.step?.where) join.filter = this.filter(scope, join, join.step.where)
      }
    }
    this.finish(scope)
    if (!scope.semanticOnly && ['UPDATE', 'DELETE'].includes(scope.kind) && scope.joins.some(join => join.required)) this.writeSelection(scope)
    return scope
  }

  source(scope, syntax) {
    if (typeof syntax === 'string') syntax = { ref: [syntax] }
    if (syntax.SELECT) {
      const query = this.plan(syntax, scope)
      scope.subqueries.set(syntax, query)
      for (const alias of query.aliases) scope.aliases.add(alias)
      const alias = scope.alias(syntax.as || '__select__')
      const source = { scope, syntax, alias, requested: syntax.as || alias, explicit: !!syntax.as, query, definition: { elements: query.elements }, children: new Map() }
      scope.sources.set(alias, source)
      scope.sourceNames.set(alias, source)
      scope.sourceNames.set(syntax.as || '__select__', source)
      return source
    }
    if (syntax.args) return { syntax, args: syntax.args.map(arg => this.source(scope, arg)), on: syntax.on }
    if (!syntax.ref) throw new Error(syntax.SET ? '”UNION” based queries are not supported' : 'Missing query source')
    const ref = syntax.ref
    let definition = scope.definition(id(ref[0]))
    if (!definition) throw new Error('"' + id(ref[0]) + '" not found in the definitions of your model')
    const navigation = []
    let previousStep = ref[0], entity = definition, names = []
    for (const step of ref.slice(1)) {
      const next = definition.elements?.[id(step)]
      if (!next) throw new Error('No association “' + id(step) + '” in ' + definition.kind + ' “' + definition.name + '”')
      if (step.where && !next.target) throw new Error('A filter can only be provided when navigating along associations')
      names.push(id(step))
      if (next.target) {
        if (!scope.semanticOnly && !next.on && !this.model.keys(next)?.length) throw new Error('Path step “' + id(step) + '” of “' + id(ref[0]) + ':' + ref.slice(1).map(id).join('.') + '” has no foreign keys')
        navigation.push({ definition: entity, association: next, prefix: names.join('_'), step: previousStep })
        previousStep = step
        entity = this.model.target(next, scope.localized)
        names = []
      }
      definition = this.model.target(next, scope.localized)
    }
    if (definition.kind !== 'entity' && !definition.target) throw new Error('Query source must be a an entity or an association')
    const requested = syntax.as || scope.implicit(id(ref.at(-1)))
    if (scope.sources.has(requested)) throw new Error('Duplicate alias "' + requested + '"')
    const alias = scope.alias(requested, !syntax.as)
    const source = { scope, syntax, alias, requested: syntax.$generatedAlias || requested, explicit: !!syntax.as && !syntax.$generatedAlias,
      definition, children: new Map(), args: ref.at(-1)?.args }
    scope.sources.set(requested, source)
    scope.sourceNames.set(requested, source)
    scope.sourceNames.set(alias, source)
    if (ref.at(-1)?.where) source.filterSyntax = ref.at(-1).where
    if (navigation.length && !scope.semanticOnly) scope.navigation = this.navigation(scope, navigation, source)
    return source
  }

  filter(scope, source, syntax) {
    if (syntax.length === 1 && Object.hasOwn(syntax[0], 'val')) {
      const keys = this.model.primaryKeys(source.definition).map(key => key.ref)
      if (keys.length !== 1) throw new Error('Shortcut notation “[' + syntax[0].val + ']” not available for composite primary key of “' + source.definition.name + '”, write “<key> = ' + syntax[0].val + '” explicitly')
      syntax = [{ ref: keys[0] }, '=', syntax[0]]
    }
    return stream(scope, syntax, { base: { source, path: [] } })
  }

  navigation(scope, steps, target) {
    const step = steps.at(-1)
    const alias = scope.alias(scope.implicit(id(step.step)))
    const query = this.plan({ SELECT: { from: { ref: [{ ...step.step, id: step.definition.name }], as: alias, $generatedAlias: scope.implicit(id(step.step)) }, columns: [{ val: 1 }] } }, scope)
    query.projections[0].outputColumn = false
    query.phase = 'binding'
    query.correlation = this.condition(query, step.association, query.from, target, step.prefix, false)
    if (steps.length > 1) query.navigation = this.navigation(query, steps.slice(0, -1), query.from)
    this.finish(query)
    return ['exists', { kind: 'query', syntax: {}, query }]
  }

  writeSelection(scope) {
    const original = scope.from
    const keys = this.model.primaryKeys(original.definition).map(key => ({ kind: 'column', source: original, name: key.name, element: key.element }))
    const query = Object.assign(Object.create(Scope.prototype), scope, {
      kind: 'SELECT', syntax: { SELECT: {} }, clause: { from: original.syntax }, projections: keys, with: undefined,
    })
    scope.writeSelection = query
    scope.writeSource = { ...original, alias: scope.alias(original.alias) }
    scope.writeKeys = keys.map(key => ({ ...key, source: scope.writeSource }))
  }

  condition(scope, association, source, target, prefix, reverse) {
    return associations.condition(scope, association, source, target, prefix, reverse)
  }

  expand(scope, binding, syntax) {
    const association = binding.leaf
    if (!association.on && !this.model.keys(association)?.length) throw new Error("Can't expand “" + association.name + '” as it has no foreign keys')
    const parent = binding.steps.slice(0, -1).findLast(step => step.join)?.join || binding.source
    if (parent.association) scope.require(parent)
    const expandName = syntax.as || binding.path.map(id).join('_')
    const alias = scope.alias(scope.implicit(expandName))
    const last = binding.path.at(-1)
    const clause = { from: { ref: [{ id: association.target, args: last.args }], as: alias, $generatedAlias: scope.implicit(expandName) }, columns: syntax.expand }
    for (const prop of ['where', 'having', 'groupBy', 'orderBy', 'limit', 'excluding', 'count']) {
      if (syntax[prop] !== undefined) clause[prop] = syntax[prop]
      if (last[prop] !== undefined) {
        if (['where', 'having'].includes(prop)) clause[prop] = and(clause[prop], last[prop])
        else if (['groupBy', 'orderBy'].includes(prop)) clause[prop] = [...(clause[prop] || []), ...last[prop]]
        else clause[prop] ??= last[prop]
      }
    }
    const query = this.plan({ SELECT: clause }, scope)
    const target = query.from
    // The parent allocated this name for sibling uniqueness; retain it here.
    target.alias = alias
    const prefix = binding.steps.slice(binding.steps.findLastIndex(s => s.join === parent) + 1).map(s => s.name).join('_')
    query.phase = 'binding'
    query.correlation = this.condition(query, association, parent, target, prefix, false)
    this.finish(query)
    query.expand = true
    query.one = association.cardinality?.max !== '*'
    return query
  }

  exists(scope, syntax, context) { return associations.exists(this, scope, syntax, context) }

  finish(scope) {
    if (scope.semanticOnly) {
      if (!this.options.metadataOnly && this.viewDepth) require('./views')(scope)
      scope.phase = 'planned'; return
    }
    for (const join of scope.joins) if (join.required && !join.on) {
      join.on = this.condition(scope, join.association, join.parent, join, join.prefix, true)
      if (join.step?.where) join.filter = this.filter(scope, join, join.step.where)
    }
    complete(scope)
    require('./views')(scope)
    scope.phase = 'planned'
  }
}

module.exports = Compiler
