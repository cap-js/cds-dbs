const cds = require('../../../index.js')
const LOG = cds.log('auth')

const {
  createSecurityContext,
  XsuaaService,
  errors: { ValidationError }
} = require('./xssec')

module.exports = function jwt_auth(config) {
  const { kind, credentials, config: serviceConfig = {} } = config

  if (!credentials)
    throw new Error(
      `Authentication kind "${kind}" configured, but no XSUAA instance bound to application. ` +
        'Either bind an XSUAA instance, or switch to an authentication kind that does not require a binding.'
    )

  const auth_service = new XsuaaService(credentials, serviceConfig)
  const user_factory = get_user_factory(credentials, credentials.xsappname.length + 1, kind)

  return async function jwt_auth(req, _, next) {
    if (!req.headers.authorization) return next()

    try {
      const securityContext = await createSecurityContext(auth_service, { req })
      const tokenInfo = securityContext.token
      const ctx = cds.context
      ctx.user = user_factory(tokenInfo)
      ctx.tenant = tokenInfo.getZoneId()
      req.authInfo = securityContext //> compat req.authInfo
    } catch (e) {
      if (e instanceof ValidationError) {
        LOG.warn('Unauthenticated request: ', e)
        return next(401)
      }
      LOG.error('Error while authenticating user: ', e)
      return next(500)
    }

    next()
  }
}

function get_user_factory(credentials, xsappname, kind) {
  return function user_factory(tokenInfo) {
    const payload = tokenInfo.getPayload()

    let id = payload.user_name

    const roles = {}
    for (let scope of payload.scope) {
      let role = scope.slice(xsappname) // Roles = scope names w/o xsappname...
      if (role in { 'internal-user': 1, 'system-user': 1 })
        continue // Disallow setting system roles from external
      else roles[role] = 1
    }

    // Add system roles in case of client credentials flow
    if (payload.grant_type in { client_credentials: 1, client_x509: 1 }) {
      id = 'system'
      roles['system-user'] = 1
      if (tokenInfo.getClientId() === credentials.clientid) roles['internal-user'] = 1
    }

    const attr = { ...payload['xs.user.attributes'] }
    if (kind === 'xsuaa') {
      attr.logonName = payload.user_name
      attr.givenName = payload.given_name
      attr.familyName = payload.family_name
      attr.email = payload.email
    }

    return new cds.User({ id, roles, attr, tokenInfo })
  }
}
