const cds = require('../../../index.js')
const LOG = cds.log('auth')

const {
  createSecurityContext,
  IdentityService,
  errors: { ValidationError }
} = require('./xssec')

module.exports = function ias_auth(config) {
  // cds.env.requires.auth.known_claims is not an official config!
  const { kind, credentials, config: serviceConfig = {}, known_claims = KNOWN_CLAIMS } = config
  const skipped_attrs = known_claims.reduce((a, x) => ((a[x] = 1), a), {})

  if (!credentials)
    throw new Error(
      `Authentication kind "${kind}" configured, but no IAS instance bound to application. ` +
        'Either bind an IAS instance, or switch to an authentication kind that does not require a binding.'
    )

  const auth_service = new IdentityService(credentials, serviceConfig)
  const user_factory = get_user_factory(credentials, skipped_attrs)

  /*
   * re validation:
   *   if the request goes to the cert url, then we should validate the token.
   *   however, this requires header "x-forwarded-client-cert" which requires additional configuration in the approuter ("forwardAuthCertificates: true").
   *   also, we currently get the non-cert route attached to the application as well (-> adjust "cds add mta"?), for which validation would always fail.
   *   by default, the approuter is configured to use the non-cert route ("url: ~{srv-url}" instead of "url: ~{srv-cert-url}").
   *   if the developer explicitely changes to the cert route, then we can expect him/her to also configure cert forwarding.
   *   hence, if there is no explicit validation configuration by the app, we can and should create a service with validation enabled and use if for the cert route.
   *   this way, we validate if possible with the least amount of custom configuration.
   */

  const should_validate =
    process.env.VCAP_APPLICATION &&
    JSON.parse(process.env.VCAP_APPLICATION).application_uris?.some(uri => uri.match(/\.cert\./))
  const validation_enabled = serviceConfig.validation?.x5t?.enabled || serviceConfig.validation?.proofToken?.enabled

  let validating_auth_service
  if (should_validate && !validation_enabled) {
    const _serviceConfig = { ...serviceConfig }
    _serviceConfig.validation = { x5t: { enabled: true }, proofToken: { enabled: true } }
    validating_auth_service = new IdentityService(credentials, _serviceConfig)
  }

  return async function ias_auth(req, _, next) {
    if (!req.headers.authorization) return next()

    try {
      const _auth_service =
        validating_auth_service && req.host.match(/\.cert\./) ? validating_auth_service : auth_service
      const securityContext = await createSecurityContext(_auth_service, { req })
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

function get_user_factory(credentials, skipped_attrs) {
  return function user_factory(tokenInfo) {
    const payload = tokenInfo.getPayload()

    const clientid = tokenInfo.getClientId()
    if (clientid === payload.sub) {
      //> grant_type === client_credentials or x509
      const roles = { 'system-user': 1 }
      if (Array.isArray(payload.ias_apis)) payload.ias_apis.forEach(r => (roles[r] = 1))
      if (clientid === credentials.clientid) roles['internal-user'] = 1
      else delete roles['internal-user']
      return new cds.User({ id: 'system', roles, tokenInfo })
    }

    // add all unknown attributes to req.user.attr in order to keep public API small
    const attr = {}
    for (const key in payload) {
      if (key in skipped_attrs)
        continue // REVISIT: Why do we need to do that?
      else attr[key] = payload[key]
    }

    // REVISIT: just don't such things, please! -> We're just piling up tech dept through tons of unoficcial long tail APIs like that!
    // REVISIT: looks like wrong direction to me, btw
    // same api as xsuaa-auth for easier migration
    if (attr.user_name) attr.logonName = attr.user_name
    if (attr.given_name) attr.givenName = attr.given_name
    if (attr.family_name) attr.familyName = attr.family_name

    return new cds.User({ id: payload.sub, attr, tokenInfo })
  }
}

// REVISIT: Why do we need to know and do that?
const KNOWN_CLAIMS = Object.values({
  /*
   * JWT claims (https://datatracker.ietf.org/doc/html/rfc7519#section-4)
   */
  ISSUER: 'iss',
  SUBJECT: 'sub',
  AUDIENCE: 'aud',
  EXPIRATION_TIME: 'exp',
  NOT_BEFORE: 'nbf',
  ISSUED_AT: 'iat',
  JWT_ID: 'jti',
  /*
   * TokenClaims (com.sap.cloud.security.token.TokenClaims)
   */
  // ISSUER: "iss", //> already in JWT claims
  IAS_ISSUER: 'ias_iss',
  // EXPIRATION: "exp", //> already in JWT claims
  // AUDIENCE: "aud", //> already in JWT claims
  // NOT_BEFORE: "nbf", //> already in JWT claims
  // SUBJECT: "sub", //> already in JWT claims
  // USER_NAME: 'user_name', //> do not exclude
  // GIVEN_NAME: 'given_name', //> do not exclude
  // FAMILY_NAME: 'family_name', //> do not exclude
  // EMAIL: 'email', //> do not exclude
  SAP_GLOBAL_SCIM_ID: 'scim_id',
  SAP_GLOBAL_USER_ID: 'user_uuid', //> exclude for now
  SAP_GLOBAL_ZONE_ID: 'zone_uuid',
  // GROUPS: 'groups', //> do not exclude
  AUTHORIZATION_PARTY: 'azp',
  CNF: 'cnf',
  CNF_X5T: 'x5t#S256',
  // own
  APP_TENANT_ID: 'app_tid'
})
