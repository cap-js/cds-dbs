'use strict'

// Build managed and unmanaged association conditions, including backlinks and EXISTS.
// Share correlation rules across joins, expands, navigation and write predicates.

const { id } = require('./syntax')
const { expression, lower } = require('./expressions')
const { pseudos } = require('../infer/pseudos')

function condition(scope, association, source, target, prefix, reverse, active = new Set()) {
  if (!association.on) {
    const pairs = scope.model.keyPairs(association)
    const tokens = []
    for (const pair of pairs) {
      if (tokens.length) tokens.push('and')
      const left = { kind: 'column', source, name: prefix + '_' + pair.source, element: pair.element }
      const right = { kind: 'column', source: target, name: pair.target, element: pair.element }
      tokens.push(reverse ? right : left, '=', reverse ? left : right)
    }
    return tokens
  }
  if (active.has(association)) throw new Error('Cyclic association condition: ' + association.name)
  active.add(association)
  try { return walk(association.on) } finally { active.delete(association) }

  function walk(tokens) {
    const output = []
    for (let i = 0; i < tokens.length; i++) {
      const lhs = tokens[i], rhs = tokens[i + 2]
      const self = value => value?.ref?.length === 1 && value.ref[0] === '$self'
      if (tokens[i + 1] === '=' && (self(lhs) || self(rhs))) {
        const other = self(lhs) ? rhs : lhs
        const ref = other.ref?.[0] === '$self' ? other.ref.slice(1) : other.ref
        const targetSide = ref?.[0] === association.name
        const base = targetSide ? target : source
        const path = targetSide ? ref.slice(1) : ref
        const backlink = scope.model.at(base.definition, path)
        if (backlink?.target) {
          if (scope.model.keys(backlink)?.length === 0) throw new Error('Path step “' + association.name + '” is a self comparison with “' + backlink.name + '” that has no foreign keys')
          const nested = condition(scope, backlink, base, targetSide ? source : target, path.join('_'), !reverse, active)
          output.push(...(i || i + 3 < tokens.length ? [{ kind: 'expression', syntax: {}, xpr: nested }] : nested))
          i += 2
          continue
        }
      }
      output.push(bind(lhs))
    }
    return lower(scope, output, { clause: 'on' })
  }

  function bind(token) {
    if (!token || typeof token !== 'object') return token
    if (token.ref && !token.param && !(token.ref[0] in pseudos.elements)) {
      const ref = token.ref[0] === '$self' ? token.ref.slice(1) : token.ref
      const head = id(ref[0])
      const targetSide = head === association.name
      const base = targetSide ? target : source
      const path = targetSide ? ref.slice(1) : ref
      return expression(scope, { ...token, ref: path }, { base: { source: base, path: [] }, on: true })
    }
    if (token.xpr || token.args || token.list) {
      const node = { kind: 'expression', syntax: token }
      if (token.xpr) node.xpr = walk(token.xpr)
      if (token.list) node.list = walk(token.list)
      if (token.args) node.args = Array.isArray(token.args) ? token.args.map(bind) : Object.fromEntries(Object.entries(token.args).map(([key, value]) => [key, Array.isArray(value) ? walk(value) : bind(value)]))
      return node
    }
    return expression(scope, token)
  }
}

function exists(compiler, scope, syntax, context = {}) {
  const pathName = syntax.$existsPath || syntax.ref.map(id).join('.')
  let path = syntax.ref, source = context.base?.source, prefix = context.base?.path || []
  if (path.length > 1 && scope.source(id(path[0]))) {
    source = scope.source(id(path[0]))
    path = path.slice(1)
    prefix = []
  } else if (['$self', '$projection'].includes(id(path[0]))) {
    throw new Error('Paths starting with “$self” must not contain steps of type “cds.Association”: ref: [ ' + path.map(id).join(', ') + ' ]')
  }
  source ||= scope.lookup(id(path[0]))
  return descend(scope, source, [...prefix, ...path])

  function descend(owner, current, steps) {
    let definition = current.definition
    const names = []
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i], name = id(step)
      const element = definition.elements?.[name]
      if (!element) throw new Error('"' + name + '" not found in "' + definition.name + '"')
      names.push(name)
      definition = element
      if (!element.target) continue
      if (!compiler.model.keys(element)?.length && !element.on) throw new Error('Path step “' + name + '” of “' + syntax.ref.map(id).join('.') + '” has no foreign keys')
      const alias = owner.alias(owner.implicit(name))
      const rest = steps.slice(i + 1)
      const where = rest.length ? ['exists', { ref: rest, $existsPath: pathName }] : undefined
      const query = compiler.plan({ SELECT: { from: { ref: [{ ...step, id: element.target }], as: alias, $generatedAlias: owner.implicit(name) }, columns: [{ val: 1 }], where } }, owner)
      query.projections[0].outputColumn = false
      query.projections[0].name = undefined
      query.phase = 'binding'
      query.correlation = condition(query, element, current, query.from, names.join('_'), true)
      compiler.finish(query)
      return query
    }
    throw new Error('Expecting path “' + pathName + '” following “EXISTS” predicate to end with association/composition, found “' + (definition.type || 'expression') + '”')
  }
}

module.exports = { condition, exists }
