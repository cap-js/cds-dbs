const { reject, getRejectReason } = require('./utils')

const _getRequiresAsArray = definition =>
  definition['@requires']
    ? Array.isArray(definition['@requires'])
      ? definition['@requires']
      : [definition['@requires']]
    : false

function check_service_level_restrictions(req) {
  if (req.user._is_privileged) {
    // > skip checks
    return
  }

  const requires = _getRequiresAsArray(this.definition)
  // internal-user is considered as a concept to protect the endpoints, local app service calls are always allowed
  if (!requires || requires.some(role => req.user.is(role)) || requires.includes('internal-user')) return
  reject(req, getRejectReason(req, '@requires', this.definition))
}

check_service_level_restrictions._initial = true

module.exports = check_service_level_restrictions
