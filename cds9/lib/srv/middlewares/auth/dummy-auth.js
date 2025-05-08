const cds = require ('../../../index'), {privileged} = cds.User

module.exports = function dummy_auth() {
  return function dummy_auth (req, res, next) {
    req.user = privileged
    next()
  }
}
