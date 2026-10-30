'use strict'

// Plan runtime views once per compilation as shared common table expressions.
// Order view dependencies, detect cycles and preserve the model-defined query syntax.

const { copy } = require('./syntax')
const { entries } = require('./model')

function runtimeViews(scope) {
  const compiler = scope.compiler
  if (!compiler.options.runtimeViews) return
  for (const source of [...scope.sources.values(), ...scope.joins.filter(join => join.required)]) {
    const definition = source.definition
    if (!Object.hasOwn(definition, '@cds.persistence.skip') || definition['@cds.persistence.skip'] !== true) continue
    if (!definition.query) throw new Error(definition.name + ' is not a runtime view')
    let view = compiler.views.get(definition)
    if (view) {
      if (!view.plan) throw new Error('Cyclic runtime view: ' + definition.name)
    } else {
      const prefix = 'RTV_' + scope.implicit(definition.name)
      let alias = prefix, suffix = 2
      while (compiler.viewNames.has(alias.toUpperCase())) alias = prefix + suffix++
      compiler.viewNames.add(alias.toUpperCase())
      view = { alias, definition }
      compiler.views.set(definition, view)
      const syntax = copy(definition.query)
      if (!syntax.SELECT) throw new Error('”UNION” based queries are not supported')
      if (!syntax.SELECT.columns) syntax.SELECT.columns = ['*']
      if (syntax.SELECT.columns.includes('*')) {
        const selected = new Set(syntax.SELECT.columns.map(column => column.as || column.ref?.at(-1)))
        for (const [name, element] of entries(definition.elements))
          if (element.type === 'cds.LargeBinary' && !selected.has(name)) syntax.SELECT.columns.push({ ref: [name] })
      }
      compiler.viewDepth = (compiler.viewDepth || 0) + 1
      try { view.plan = compiler.plan(syntax) } finally { compiler.viewDepth-- }
      view.plan.viewDefinition = definition
      compiler.viewOrder.push(view)
    }
    source.runtimeView = view
  }
}

module.exports = runtimeViews
