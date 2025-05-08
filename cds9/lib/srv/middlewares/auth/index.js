const cds = require ('../../../index.js')

const _builtin = {
  mocked: 'basic-auth',
  basic:  'basic-auth',
  ias:    'ias-auth',
  jwt:    'jwt-auth',
  xsuaa:  'jwt-auth',
  dummy:  'dummy-auth',
}
for (let b in _builtin)  _builtin[b+'-auth'] = _builtin[b]


/**
 * Constructs auth middlewares as configured
 */
module.exports = function auth_factory (o) {

  // prepare options
  const options = { ...o, ...cds.requires.auth }
  let { kind, impl } = options

  // if no impl is given, it's a built-in strategy
  if (!impl) impl = __dirname + '/' + _builtin[kind]
  else if (kind in _builtin) kind = 'custom'
  // NOTE:                   ^^^^^^^^^^^^^^^
  // This is a workaround to avoid displaying kind:'mocked-auth'
  // from [development] defaults with impl: './custom-auth'
  // from cds.requires.auth in the log or error output below.

  // try resolving the impl, throw if not found
  const config = { kind, impl: cds.utils.local(impl) }
  // use cds.resolve() to allow './srv/auth.js' and 'srv/auth.js' -> REVISIT: cds.resolve() is not needed here, and not meant for that !
  try { impl = require.resolve (cds.resolve (impl)?.[0], {paths:[cds.root]}) } catch {
    throw cds.error `Didn't find auth implementation for ${config}`
  }

  // load the auth middleware from the resolved path
  cds.log().info ('using auth strategy', config, '\n')
  let auth = require (impl)

  // default export of ESM / .ts auth
  if (auth && auth.default) auth = auth.default

  // if auth is a factory itself, call it to get the middleware
  if (typeof auth === 'function' && auth.length < 3) auth = auth(options)

  // return the auth middleware followed by a middleware to fill in cds.context
  return auth
}
