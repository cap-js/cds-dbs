'use strict'

const cds = require('@sap/cds')
const cloneCqn = require('../cqn4sql/clone')
const resolve = require('../cqn4sql/resolve')

// Compatibility API for callers that still need the legacy element metadata.
// SQL transformation uses the resolver directly and owns its query graph.
module.exports = function infer(query, model, useTechnicalAlias = true) {
  const owned = typeof query === 'string' ? cds.parse.cql(query) : cloneCqn(query)
  return resolve(owned, model, useTechnicalAlias, true).query
}
