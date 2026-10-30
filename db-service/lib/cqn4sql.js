'use strict'

const cds = require('@sap/cds')
const Compiler = require('./cqn4sql/plan')
const emit = require('./cqn4sql/emit')
const allocate = require('./cqn4sql/aliases')
const { hidden } = require('./cqn4sql/syntax')
const { eqOps, notEqOps, notSupportedOps } = require('./cqn4sql/expressions')

function cqn4sql(input, model, useTechnicalAlias = true) {
  const query = typeof input === 'string' ? cds.parse.cql(input) : input
  const options = {
    technicalAliases: useTechnicalAlias,
    runtimeViews: !!cds.env.features.runtime_views,
    rankedSearch: cds.db?.kind === 'hana' && cds.env.hana?.fuzzy !== false && cds.env.hana?.fuzzy?.ranked_search !== false,
  }
  const compiler = new Compiler(model, options)
  const result = emit(allocate(compiler.plan(query)))
  if (compiler.viewOrder.length) result._with = compiler.viewOrder.map(view => {
    const query = emit(allocate(view.plan))
    query.as = view.alias
    hidden(query, '_source', view.definition)
    return query
  })
  return result
}

module.exports = Object.assign(cqn4sql, { eqOps, notEqOps, notSupportedOps })
