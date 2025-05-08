const { getAuthRelevantEntity } = require('./utils')
const { WRITE_EVENTS } = require('../../constants/events')

function check_readonly(req) {
  // @read-only
  let entity = getAuthRelevantEntity(req, this.model, ['@readonly'])
  entity = entity?.actives || entity

  if (!entity || !entity['@readonly']) return
  if (entity['@readonly'] && req.event in WRITE_EVENTS) req.reject(405, 'ENTITY_IS_READ_ONLY', [entity.name])
}

check_readonly._initial = true

module.exports = check_readonly
