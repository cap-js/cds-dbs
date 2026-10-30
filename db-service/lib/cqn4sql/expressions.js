'use strict'

const { reference } = require('./bind')
const { typeFor, fullName } = require('./model')
const { id } = require('./syntax')

const eqOps = [['is'], ['=']]
const notEqOps = [['is', 'not'], ['<>'], ['!=']]
const notSupportedOps = [['>'], ['<'], ['>='], ['<='], ['*'], ['+'], ['-'], ['/']]

function expression(scope, syntax, context = {}) {
  if (!syntax || typeof syntax !== 'object') return syntax
  if (syntax.cast || '#' in syntax) scope.needsMetadata = true
  if (syntax.ref) return reference(scope, syntax, context)
  if (syntax.SELECT) {
    const query = scope.compiler.plan(syntax, scope)
    scope.subqueries.set(syntax, query)
    return { kind: 'query', syntax, query, element: typeFor(syntax) }
  }
  const result = { kind: 'expression', syntax, element: typeFor(syntax) }
  if (syntax.xpr) result.xpr = stream(scope, syntax.xpr, { ...context, clause: 'expression' })
  if (syntax.list) result.list = stream(scope, syntax.list, { ...context, clause: 'list' })
  if (syntax.args) result.args = Array.isArray(syntax.args)
    ? syntax.args.flatMap(arg => stream(scope, [arg], { ...context, clause: 'expression' }))
    : Object.fromEntries(Object.entries(syntax.args).map(([name, arg]) => [name,
      Array.isArray(arg) ? stream(scope, arg, context) : stream(scope, [arg], { ...context, clause: 'expression' })[0]]))
  return result
}

function stream(scope, tokens, context = {}) {
  if (!tokens) return undefined
  const result = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === 'exists' && tokens[i + 1]?.ref && scope.semanticOnly) {
      result.push('exists', expression(scope, tokens[++i], { ...context, exists: true }))
    } else if (token === 'exists' && tokens[i + 1]?.ref) {
      result.push('exists', { kind: 'query', syntax: {}, query: scope.compiler.exists(scope, tokens[++i], context) })
    } else result.push(expression(scope, token, context))
  }
  return lower(scope, result, context)
}

function lower(scope, result, context = {}) {
  if (scope.semanticOnly) return result
  for (let i = 0; i < result.length; i++) {
    const lhs = result[i]
    if (result[i + 1] === 'in' && result[i + 2]?.list?.length === 0)
      result.splice(i + 1, 2, '=', { kind: 'expression', syntax: { val: null } })
    else if (result[i + 1] === 'not' && result[i + 2] === 'in' && result[i + 3]?.list?.length === 0)
      result.splice(i + 1, 3, 'is', 'not', 'null')
    let operator = result[i + 1], right = i + 2
    if (operator === 'is' && result[right] === 'not') { operator = 'is not'; right++ }
    const rhs = result[right]
    if ((lhs?.leaf?.on || rhs?.leaf?.on) && (operator || !['groupBy', 'orderBy'].includes(context.clause))) throw new Error("An association can't be used as a value in an expression")
    const structure = node => node?.kind === 'ref' && (node.leaf.elements || node.leaf.target)
    if ((!structure(lhs) && !structure(rhs)) || typeof operator !== 'string') continue
    if (![...eqOps, ...notEqOps, ...notSupportedOps].some(op => op.join(' ') === operator)) continue
    if (notSupportedOps.some(op => op[0] === operator)) throw new Error('The operator "' + operator + '" can only be used with scalar operands')
    const flatten = node => structure(node) ? scope.model.leaves(node.leaf).map(leaf => ({ ...node, suffix: leaf, element: leaf.element })) : [node]
    const lefts = flatten(lhs), rights = flatten(rhs)
    if (lhs?.kind === 'ref' && rhs?.kind === 'ref' && (!structure(lhs) || !structure(rhs))) {
      const struct = structure(lhs) ? lhs : rhs, scalar = structure(lhs) ? rhs : lhs
      throw new Error('Can\'t compare structure “' + struct.syntax.ref.map(id).join('.') + '” with non-structure “' + scalar.syntax.ref.map(id).join('.') + '”')
    }
    if (structure(lhs) && structure(rhs)) {
      const index = new Map(rights.map(r => [r.suffix.path.join('.'), r]))
      if (lefts.length !== rights.length || lefts.some(l => !index.has(l.suffix.path.join('.')))) throw new Error('Can\'t compare "' + lhs.syntax.ref.map(id).join('.') + '" with "' + rhs.syntax.ref.map(id).join('.') + '": the operands must have the same structure')
      rights.splice(0, rights.length, ...lefts.map(l => index.get(l.suffix.path.join('.'))))
    } else {
      const [struct, value, leaves] = structure(lhs) ? [lhs, rhs, lefts] : [rhs, lhs, rights]
      if (leaves.length !== 1 && value !== 'null' && value?.syntax?.val !== null) {
        const assoc = struct.leaf.target
        throw new Error('Can\'t compare ' + (assoc ? 'association' : 'structure') + ' "' + struct.syntax.ref.map(id).join('.') + '" to value "' + value?.syntax?.val + '"; only possible for ' + (assoc ? 'associations with one foreign key' : 'structures with one sub-element'))
      }
    }
    if (!lefts.length || !rights.length) throw new Error("Can't compare two empty structures")
    const count = Math.max(lefts.length, rights.length)
    const expanded = []
    for (let j = 0; j < count; j++) {
      if (j) expanded.push(notEqOps.some(op => op.join(' ') === operator) ? 'or' : 'and')
      expanded.push(lefts[j] || lefts[0], ...operator.split(' '), rights[j] || rights[0])
    }
    const replacement = i || right + 1 < result.length ? [{ kind: 'expression', syntax: {}, xpr: expanded }] : expanded
    result.splice(i, right - i + 1, ...replacement)
    i += replacement.length - 1
  }
  return result.flatMap(bound => {
    if (bound?.skip && ['groupBy', 'orderBy'].includes(context.clause)) return []
    if (bound?.kind !== 'ref' || bound.calculation || bound.suffix) return [bound]
    if (bound.skip && ['groupBy', 'orderBy'].includes(context.clause)) return []
    if (bound.leaf.virtual) throw new Error('Virtual elements are not allowed in expressions')
    const assoc = bound.leaf.target, struct = bound.leaf.elements
    if (!assoc && !struct) return [bound]
    if (bound.leaf.on && ['groupBy', 'orderBy'].includes(context.clause)) return []
    if (bound.leaf.on || (['where', 'having'].includes(context.clause) && assoc)) throw new Error("An association can't be used as a value in an expression")
    if (['where', 'having'].includes(context.clause) && struct) throw new Error("A structured element can't be used as a value in an expression")
    if (context.clause === 'groupBy' || context.clause === 'orderBy') return [bound]
    const leaves = scope.model.leaves(bound.leaf)
    if (!leaves.length || (leaves.length > 1 && context.clause !== 'list')) throw new Error('Structured element “' + fullName(bound.leaf) + '” expands to ' + (leaves.length ? 'multiple fields' : 'nothing') + ' and can\'t be used in expressions')
    return leaves.map(leaf => ({ ...bound, suffix: leaf, element: leaf.element }))
  })
}

module.exports = { expression, stream, lower, eqOps, notEqOps, notSupportedOps }
