const cds = require('../../lib')
const LOG = cds.log('odata')

const HttpAdapter = require('../../lib/srv/protocols/http')
const HttpRequest = require('../http/HttpRequest')
const bodyParser4 = require('../http/body-parser')

class ODataRequest extends HttpRequest {
  get protocol() {
    return 'odata'
  }
}

const operation4 = require('./middleware/operation')
const create4 = require('./middleware/create')
const stream4 = require('./middleware/stream')
const read4 = require('./middleware/read')
const update4 = require('./middleware/update')
const delete4 = require('./middleware/delete')
const error4 = require('./middleware/error')

const { isStream } = require('./utils')

// REVISIT: copied from lib/req/request.js
const Http2Crud = { POST: 'CREATE', GET: 'READ', PUT: 'UPDATE', PATCH: 'UPDATE', DELETE: 'DELETE' }

module.exports = class ODataAdapter extends HttpAdapter {
  request4(args) {
    return new ODataRequest(args)
  }

  get router() {
    const jsonBodyParser = bodyParser4(this)
    return (
      super.router
        .use(function odata_version(req, res, next) {
          res.set('OData-Version', '4.0')
          next()
        })
        // REVISIT: add middleware for negative cases?
        // service root
        .use(/^\/$/, require('./middleware/service-document')(this))
        .use('/\\$metadata', require('./middleware/metadata')(this))
        // parse
        .use(require('./middleware/parse')(this))
        .use(function odata_streams(req, res, next) {
          if (req.method === 'PUT' && isStream(req._query)) {
            req.body = { value: req }
            return next()
          }
          if (req.method === 'POST' && req.headers['content-type']?.match(/multipart\/mixed/)) {
            return next()
          }
          // POST with empty body is allowed by actions
          if (req.method in { PUT: 1, PATCH: 1 }) {
            if (req.headers['content-length'] === '0') {
              res.status(400).json({ error: { message: 'Expected non-empty body', statusCode: 400, code: '400' } })
              return
            }
          }
          if (req.method in { POST: 1, PUT: 1, PATCH: 1 }) {
            const contentType = req.headers['content-type'] ?? ''
            let contentLength = req.headers['content-length']
            contentLength = contentLength ? parseInt(contentLength) : 0

            const parts = contentType.split(';')
            // header ending with semicolon is not allowed
            if ((contentLength && !parts[0].match(/^application\/json$/)) || parts[1] === '') {
              res.status(415).json({ error: { message: 'Unsupported Media Type', statusCode: 415, code: '415' } })
              return
            }
          }

          return jsonBodyParser(req, res, next)
        })
        // batch
        // .all is used deliberately instead of .use so that the matched path is not stripped from req properties
        .all('/\\$batch', require('./middleware/batch')(this))
        // handle
        // REVISIT: with old adapter, we return 405 for HEAD requests -> check OData spec
        .head('*', (_, res) => res.sendStatus(405))
        .post('*', operation4(this), create4(this))
        .get('*', operation4(this), stream4(this), read4(this))
        .use('*', (req, res, next) => {
          // operations must have been handled above (POST or GET)
          const { operation } = req._query.SELECT?.from.ref?.slice(-1)[0] || {}
          next(operation ? { code: 405 } : undefined)
        })
        .put('*', update4(this), create4(this, 'upsert'))
        .patch('*', update4(this), create4(this, 'upsert'))
        .delete('*', delete4(this))
        // error
        .use(error4(this))
    )
  }

  // REVISIT: this impl recreates the behavior of the old adapter, but is not very clean
  log(req) {
    // req.__proto__.method is set in case of upsert
    if (req.__proto__.method in { PUT: 1, PATCH: 1 }) return // REVISIT: voodoo magic

    if (req._subrequest) {
      //> req._subrequest is set for batch subrequests
      LOG._info && LOG.info('>', Http2Crud[req.method], req.path, Object.keys(req.query).length ? { ...req.query } : '')
    } else {
      super.log(req)
    }
  }
}
