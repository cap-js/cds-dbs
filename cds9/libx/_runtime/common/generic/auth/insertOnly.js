const { getAuthRelevantEntity } = require('./utils')

function check_insertonly(req) {
  const entity = getAuthRelevantEntity(req, this.model, ['@insertonly'])
  if (!entity || !entity['@insertonly']) return

  const allowed = entity._isDraftEnabled ? { NEW: 1, PATCH: 1 } : { CREATE: 1 }
  if (!(req.event in allowed)) {
    req.reject(405, 'ENTITY_IS_INSERT_ONLY', [entity.name])
  }
}

check_insertonly._initial = true

module.exports = check_insertonly
