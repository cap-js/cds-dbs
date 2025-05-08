/**
 * Users factory function which can be used as follows:
 * - `User(<string>)` - returns a new user instance with the given string as id
 * - `User(<object>)` - returns a new user instance with the given properties
 * - `User(<none>)`   - returns the default user if the argument is undefined
 * - `User(<user>)`   - returns the given user if it's an instance of `User`
 * - `new User(...)`  - always constructs a new instance of User
 */
module.exports = exports = function (u) {
  return new.target ? new User(u) :
    u === undefined ? exports.default :
    u instanceof User ? u :
    new User(u)
}

/** Class representing users */
class User {

  constructor (_) {
    if (typeof _ === 'string') this.id = _
    else Object.assign(this,_)
  }

  get attr() { return super.attr = {} }
  set attr(a) { super.attr = a }

  get roles() { return super.roles = {} }
  set roles(r) {
    super.roles = Array.isArray(r) ? r.reduce((p,n) => (p[n]=1, p), {}) : r
  }

  has (role) { return this.is(role) }
  is (role) {
    return (
      role === 'authenticated-user' ||
      role === 'identified-user' ||
      role === 'any' ||
      role in this.roles // REVISIT: This may break something, did in the past, but we don't know anymore. we should know.
    )
  }
  valueOf() { return this.id }
}


/** Subclass representing unauthenticated users. */
class Anonymous extends User {}
Object.assign (Anonymous.prototype, {
  is: role => role === 'any',
  _is_anonymous: true,
  id: 'anonymous',
  roles: {},
  attr: {},
})
exports.anonymous = exports.default = Object.seal (new Anonymous)
exports.Anonymous = Anonymous


/** Subclass for executing code with superuser privileges. */
class Privileged extends User {}
Object.assign (Privileged.prototype, {
  is: () => true,
  _is_privileged: true,
  id: 'privileged',
  roles: {},
  attr: {},
})
exports.privileged = Object.seal (new Privileged)
exports.Privileged = Privileged


// Allow setting default user by class for compatibility, e.g.: User.default = User.Privileged
Object.defineProperty (exports, 'default', {
  set(v) { this._default = typeof v === 'function' ? new v : v },
  get() { return this._default },
})
exports._default = exports.anonymous
exports.class = User
