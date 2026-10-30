'use strict'

const cds = require('@sap/cds')
const Compiler = require('../cqn4sql/plan')
const { emit } = require('../cqn4sql/logical')

module.exports = function infer(input, model, useTechnicalAlias = true) {
  const syntax = typeof input === 'string' ? cds.parse.cql(input) : input
  const compiler = new Compiler(model, {
    metadataOnly: true,
    technicalAliases: useTechnicalAlias,
    runtimeViews: !!cds.env.features.runtime_views,
  })
  return emit(compiler.plan(syntax))
}
