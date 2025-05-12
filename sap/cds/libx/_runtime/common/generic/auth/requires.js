const { reject, getRejectReason, getAuthRelevantEntity } = require('./utils')
const { CRUD_EVENTS } = require('../../constants/events')

const _getRequiresAsArray = definition =>
  definition['@requires']
    ? Array.isArray(definition['@requires'])
      ? definition['@requires']
      : [definition['@requires']]
    : false

function check_auth_privileges(req) {
  if (req.user._is_privileged) {
    // > skip checks
    return
  }

  let definition
  if (req.event in CRUD_EVENTS) {
    // > CRUD
    definition = getAuthRelevantEntity(req, this.model, ['@requires', '@restrict'])
  } else if (req.target?.actions) {
    // > bound
    definition = req.target.actions[req.event]
  } else {
    // > unbound
    definition = this.operations[req.event]
  }

  if (!definition) return

  // also check target entity for bound operations
  const requires =
    _getRequiresAsArray(definition) ||
    (['action', 'function'].includes(definition.kind) && req.target && _getRequiresAsArray(req.target))
  if (!requires || requires.some(role => req.user.is(role))) return

  reject(req, getRejectReason(req, '@requires', definition))
}

check_auth_privileges._initial = true

module.exports = check_auth_privileges
