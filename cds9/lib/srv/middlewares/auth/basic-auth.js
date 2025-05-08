module.exports = function basic_auth (options) {

  const cds = require ('../../../index'), DEBUG = cds.debug('basic|auth')
  const users = require ('./mocked-users') (options)
  const login_required = options.login_required || cds.requires.multitenancy || process.env.NODE_ENV === 'production' && options.credentials

  /** @type { import('express').Handler } express_handler */
  return async function basic_auth (req, res, next) {
    req._login = login // allow subsequent code to request a user login
    let auth = req.headers.authorization // get basic authorization header
    // enforce login if requested
    if (!auth?.match(/^basic/i)) return login_required ? req._login() : next()
    // decode user credentials from autorization header
    let [id,pwd] = Buffer.from(auth.slice(6),'base64').toString().split(':')
    // verify user credentials and set req.user
    let u = req.user = await users.verify (id, pwd)
    // re-request login in case of wrong credentials
    if (u.failed) return req._login()
    // user authenticated...
    const ctx = cds.context; ctx.user = u
    const features = req.headers.features || u.features // IMPORTANT: only here not as public API
    if (features) ctx.features = features
    if (u.tenant) ctx.tenant = u.tenant
    DEBUG?.('authenticated:', { user: u.id, tenant: u.tenant, features })
    // done
    next()
  }

  function login() {
    DEBUG?.(401, '> login required') // REVISIT: do we really need auth checks on HEAD requests?
    this.res.set('WWW-Authenticate', `Basic realm="Users"`).sendStatus(401)
  }
}
