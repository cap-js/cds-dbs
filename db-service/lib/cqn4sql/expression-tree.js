'use strict'

// SELECT owns a new scope. Callers decide how EXISTS affects sibling tokens.
function forEachChild(token, visit) {
  if (!token || token.SELECT) return
  for (const prop of ['args', 'list', 'xpr']) {
    const children = token[prop]
    if (!children) continue
    const values = Array.isArray(children) ? children : Object.values(children)
    values.forEach((child, i) => visit(child, i, prop, values))
  }
}

function mapArgs(args, transform) {
  if (Array.isArray(args)) return args.flatMap(transform)
  if (typeof args === 'object')
    return Object.fromEntries(Object.entries(args || {}).map(([name, arg]) => [name, transform(arg)[0]]))
  return null
}

module.exports = { forEachChild, mapArgs }
