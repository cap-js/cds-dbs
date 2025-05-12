const cds = require('../../index'), { decodeURI } = cds.utils
const express = require('express')
const production = process.env.NODE_ENV === 'production'
const restrict_all = cds.env.requires.auth?.restrict_all_services !== false
const restricted_by_default = production && restrict_all ? ['authenticated-user'] : false


class HttpAdapter {

  /** Constructs and returns a new express.Router */
  constructor (srv,o={}) {
    this.kind = o.kind || this.constructor.name.replace(/Adapter$/,'').toLowerCase()
    this.service = srv
    this.options = o
    return this.router //> constructed by getter
  }

  /** The actual Router factory. Subclasses override this to add specific handlers. @returns {express.Router} */
  get router() {
    let router = super.router = new express.Router
    this.use (this.http_log)
    this.use (this.requires_check)
    return router
  }

  use (middleware) {
    if (middleware) this.router.use (middleware)
    return this
  }

  /** Subclasses may override this method to log incoming requests. */
  log (req, LOG = this.logger) { LOG.info (
    req.method,
    decodeURI (req.baseUrl + req.path),
    Object.keys (req.query).length ? { ...req.query } : ''
  )}

  /** Returns a handler to log all incoming requests */
  get http_log() {
    const LOG = this.logger = cds.log(this.kind); if (!LOG._info) return undefined
    const log = this.log.bind(this)
    return function http_log (req,_,next) { log(req,LOG); next() }
  }

  /** Returns a handler to check required roles, or null if no check required. */
  get requires_check() {
    const d = this.service.definition; if (!d) return null
    const roles = d['@requires'] || d['@restrict']?.map(r => r.to).flat().filter(r => r)
    const required = !roles?.length ? restricted_by_default : Array.isArray(roles) ? roles : [roles]
    return required && function requires_check (req, res, next) {
      const user = cds.context.user
      if (required.some(role => user.has(role))) return next()
      else if (user._is_anonymous) return next(401) // request login
      else throw Object.assign(new Error, { code: 403, reason: `User '${user.id}' is lacking required roles: [${required}]`, user, required })
    }
  }

  get body_parser_options() {
    let options = cds.env.server.body_parser
    let limit = this.service.definition?.['@cds.server.body_parser.limit']
    if (limit) options = { ...options, limit }
    return super.body_parser_options = options
  }
}


module.exports = HttpAdapter
