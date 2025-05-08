const cds = require('../../index'), {inspect} = cds.utils
const express = require('express')
const LOG = cds.log('hcql')
const PROD = process.env.NODE_ENV === 'production'

class HCQLAdapter extends require('./http') {

  get router() {

    const router = super.router
    .get ('/\\$csn', this.schema.bind(this))      //> return the CSN as schema
    .use (express.json(this.body_parser_options)) //> for application/json -> cqn
    .use (express.text(this.body_parser_options)) //> for text/plain -> cql -> cqn

    // Route for custom actions and functions ...
    const action = this.action.bind(this)
    router.param('action', (r,_,next,a) => a in this.service.actions ? next() : next('route'))
    router.route('/:action')
    .post (action)
    .get (action)
    .all ((req,res,next) => next(501))

    // Route for REST-style convenience shortcuts with queries in URL + body ...
    const $ = cb => (req,_,next) => { req.body = cb(req.params,req); next() }
    PROD || router.route('/:entity/:id?')
    .get ($(({entity,id,tail}, req) => {
      if (entity.includes(' ')) [,entity,tail] = /^(\w+)( .*)?/.exec(entity)
      if (id?.includes(' ')) [,id,tail] = /^(\w+)( .*)/.exec(id)
      let q = SELECT.from (entity,id), body = req.body
      if (body) Object.assign (q.SELECT, ql_fragment(body))
      if (tail) Object.assign (q.SELECT, ql_fragment(tail))
      return q
    }))
    .post   ($(({entity}, {query,body}) => INSERT.into (entity) .entries ({...query,...body})))
    .put    ($(({entity,id}, {query,body}) => UPDATE (entity,id) .with ({...query,...body})))
    .patch  ($(({entity,id}, {query,body}) => UPDATE (entity,id) .with ({...query,...body})))
    .delete ($(({entity,id}) => DELETE.from (entity, id)))

    // The ultimate handler for CRUD requests
    router.use (this.crud.bind(this))
    return router
  }


  /**
   * Handle requests to custom actions and functions.
   */
  action (req, res, next) {
    return this.service.send (req.params.action, { ...req.query, ...req.body })
    .then (results => this.reply (results, res))
    .catch (next)
  }


  /**
   * The ultimate handler for all CRUD requests.
   */
  crud (req, res, next) {
    let query = this.query4 (req)
    return this.service.run (query)
    .then (results => this.reply (results, res))
    .catch (next)
  }


  /**
   * Constructs an instance of cds.ql.Query from an incoming request body,
   * which is expected to be a plain CQN object or a CQL string.
   */
  query4 (/** @type express.Request */ req) {
    let q = req.body = cds.ql(req.body) || this.error (400, 'Invalid query', { query: req.body })
    // handle request headers
    if (q.SELECT) {
      if (req.get('Accept-Language')) q.SELECT.localized = true
      if (req.get('X-Total-Count')) q.SELECT.count = true
    }
    // got a valid query
    if (LOG._debug) LOG.debug (inspect(q))
    return this.valid(q)
  }

  /**
   * Checks whether the service actually serves the target entity.
   */
  valid (query) {
    if (!this.service.definition) return query
    let target = cds.infer.target (query, this.service)
    if (target._unresolved) throw this.error (400, `${target.name} is not an entity served by '${this.service.name}'.`, { query })
    return query
  }

  /**
   * Serialize the results into response.
   */
  reply (results, /** @type express.Response */ res) {
    if (!results) return res.end()
    if (results.$count) res.set ('X-Total-Count', results.$count)
    if (typeof results === 'object') return res.json (results)
    else res.send (results)
  }

  /**
   * Throw an Error with given status and message.
   */
  error (status, message, details) {
    if (typeof status === 'string') [ message, details, status ] = [ status, message ]
    let err = Object.assign (new Error(message), details)
    if (status) err.status = status
    if (new.target) return err
    else throw err
  }

  /**
   * Return the CSN as schema in response to /<srv>/$csn requests
   */
  schema (_, res) {
    let csn = cds.minify (this.service.model, { service: this.service.name })
    return res.json (csn)
  }
}

const ql_fragment = x => {
  if (x.length) {
    x = SELECT (`from x ${x}`).SELECT
    delete x.from
  }
  return x
}
module.exports = HCQLAdapter
