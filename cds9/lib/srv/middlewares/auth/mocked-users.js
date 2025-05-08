const cds = require ('../../../index.js'), { User } = cds
const LOG = cds.log('auth')

class MockedUsers {

  constructor (options) {
    const tenants = this.tenants = options.tenants || {}
    const users = this.users = options.users || {}
    for (let [k,v] of Object.entries(users)) {
      if (!cds.env.requires.multitenancy) delete v.tenant
      if (typeof v === 'boolean') continue
      if (typeof v === 'string') v = { password:v }
      let id = _configured(v).id || k
      let u = users[id] = new User ({ id, ...v })
      let fts = tenants[u.tenant]?.features
      if (fts && !u.features) u.features = fts
    }
  }

  /**
   * Verifies a username / password combination against configured users.
   * @returns { {id:string} | {failed:string} }
   * - `{id,...}` &rarr; a user object for successfully authenticated users
   * - `{failed}` &rarr; for failed authentication, i.e., invalid credentials
   */
  verify (id, pwd) {
    let u = this.users[id]
    if (!u) return id && this.users['*'] ? { id } : { failed: `User '${id}' not found` }
    if (u.password && pwd !== u.password) return { failed: `Wrong password for user '${id}'` }
    return u
  }
}

const _configured = (u,x) => {
  if ((x = _deprecated (u.ID, 'ID','id'))) {
    u.id = x
  }
  if ((x = _deprecated (u.userAttributes, 'userAttributes','attr'))) {
    u.attr = { ...u.attr, ...x }
  }
  if (u.jwt) {
    if ((x = _deprecated (u.jwt.zid, 'jwt.zid','tenant'))) {
      u.tenant = u.jwt.zid
    }
    if ((x = _deprecated (u.jwt.attributes, 'jwt.attributes','attr'))) {
      u.attr = { ...u.attr, ...x }
    }
    if ((x = _deprecated (u.jwt.userInfo, 'jwt.attributes','attr'))) {
      u.attr = { ...u.attr, ...x }
    }
    if ((x = _deprecated (u.jwt.scope || u.jwt.scopes, 'jwt.scopes','roles'))) {
      const {aud} = u.jwt; if (aud) x = x.map (s => {
        for (const each of aud) s = s.replace(`${each}.`, '')
        return s
      })
      u.roles = [ ...u.roles||[], ...x ]
    }
  }
  return u
}

const _deprecated = (v,x,y) => {
  if (!v || x in _deprecated) return v
  else LOG.warn(`WARNING: \n
    Usage of '${x}' in user configurations is deprecated and won't be
    supported in future releases. → Please use property '${y}' instead.
  `)
  return _deprecated[x] = v
}


// allows calling with or without new
module.exports = function(o) { return new MockedUsers(o) }
