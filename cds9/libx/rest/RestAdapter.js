const cds = require('../_runtime/cds')

const HttpAdapter = require('../../lib/srv/protocols/http')
const HttpRequest = require('../http/HttpRequest')
const bodyParser4 = require('../http/body-parser')

class RestRequest extends HttpRequest {
  get protocol() {
    return 'rest'
  }
}

const parse = require('./middleware/parse')
const create = require('./middleware/create')
const read = require('./middleware/read')
const update = require('./middleware/update')
const upsert = require('./middleware/upsert')
const deleet = require('./middleware/delete')
const operation = require('./middleware/operation')
const error = require('./middleware/error')

const { postProcessData } = require('./post-processing')

module.exports = class RestAdapter extends HttpAdapter {
  request4(args) {
    return new RestRequest(args)
  }

  get router() {
    const srv = this.service
    const router = super.router

    // service root
    router.head('/', (_, res) => res.json({}))
    const entities = Object.keys(srv.entities).map(e => ({ name: e, url: e }))
    router.get('/', (_, res) => res.json({ entities }))

    // validate headers
    router.use((req, res, next) => {
      if (req.method in { POST: 1, PUT: 1, PATCH: 1 } && req.headers['content-type']) {
        const parts = req.headers['content-type'].split(';')
        if (!parts[0].match(/^application\/json$/) || parts[1] === '') {
          throw cds.error('INVALID_CONTENT_TYPE_ONLY_JSON', { statusCode: 415, code: '415' }) // FIXME: better i18n + use res.status
        }
      }
      if (req.method in { PUT: 1, PATCH: 1 }) {
        if (req.headers['content-length'] === '0') {
          res.status(400).json({ error: { message: 'Malformed document', statusCode: 400, code: '400' } })
          return
        }
      }

      return next()
    })
    router.use(bodyParser4(this))
    router.use(parse(this))

    // handlers
    const action_handler = operation(this)
    const crud_handlers = {
      HEAD: read(this),
      GET: read(this),
      PUT: upsert(this),
      POST: create(this),
      PATCH: cds.env.runtime.patch_as_upsert ? upsert(this) : update(this),
      DELETE: deleet(this)
    }

    router.use((req, res, next) => {
      const handle = req._operation ? action_handler : crud_handlers[req.method]
      handle(req, res).then(outcome => {
        // if authentication or something else within the processing of a cds.Request terminates the request, no need to continue
        if (res.headersSent) return next()

        const { result, status, location } = outcome

        // post process
        if (result) {
          let def = req._operation || cds.infer.target(req._query)
          const defs = srv.model.definitions
          if (typeof def === 'string') def = defs[def] || defs[def.split(':$:')[0]].actions[def.split(':$:')[1]]
          if (def) postProcessData(result, srv, def)
        }

        if (status && res.statusCode === 200) res.status(status) //> only set status if not yet modified
        if (location && !res.get('location')) res.set('location', location)

        if (req.method === 'HEAD') res.type('json').set('content-length', JSON.stringify(result).length).end()
        else res.send(typeof result === 'number' ? result.toString() : result)
      }, next)
    })

    // error handling
    router.use(error(this))

    return router
  }
}
