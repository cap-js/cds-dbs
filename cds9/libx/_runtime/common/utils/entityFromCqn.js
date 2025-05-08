const { ensureNoDraftsSuffix } = require('../../common/utils/draft')

const traverseFroms = (cqn, cb, aliasForSet) => {
  while (cqn.SELECT) cqn = cqn.SELECT.from

  // Do the most likely first -> {ref}
  if (cqn.ref) {
    return cb(cqn, aliasForSet)
  }

  if (cqn.SET) {
    // if a union has an alias, we should use it for the columns we get out of the union
    return cqn.SET.args.map(a => traverseFroms(a, cb, cqn.as))
  }

  if (cqn.join) {
    return cqn.args.map(a => traverseFroms(a, cb, aliasForSet))
  }
}

const getEntityNameFromCQN = cqn => {
  const res = []
  traverseFroms(cqn, (from, aliasForSet) =>
    res.push({ entityName: from.ref[0].id || from.ref[0], alias: aliasForSet || from.as })
  )
  return res.length === 1 ? res[0] : res.find(n => n.entityName !== 'DRAFT.DraftAdministrativeData') || {}
}

// Note: This also works for the common draft scenarios
const getEntityFromCQN = (req, service) => {
  if (!req.target || req.target._unresolved) {
    const { entityName } = getEntityNameFromCQN(req.query)
    return entityName && service.model.definitions[ensureNoDraftsSuffix(entityName)]
  }
  return req.target
}

module.exports = {
  getEntityFromCQN,
  getEntityNameFromCQN,
  traverseFroms
}
