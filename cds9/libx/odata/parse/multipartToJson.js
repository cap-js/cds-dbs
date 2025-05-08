const cds = require('../../../')
const LOG = cds.log('odata')

const { parsers, freeParser, HTTPParser } = require('_http_common')
const { PassThrough, Readable } = require('stream')
const streamConsumers = require('stream/consumers')

const { getBoundary } = require('../utils')

const CRLF = '\r\n'

let MAX_BATCH_HEADER_SIZE

const _normalizeSize = size => {
  const match = size.match(/^([0-9]+)([\w ]+)$/i)
  if (!match) return
  let [, val, unit] = match
  unit = unit.toLowerCase().trim()
  switch (unit) {
    case 'b':
      return val
    case 'kb':
      return val * 1000
    case 'kib':
      return val * 1024
    case 'mb':
      return val * 1000 * 1000
    case 'mib':
      return val * 1024 * 1024
    default:
      return
  }
}

const _parseStream = async function* (body, boundary) {
  const parser = parsers.alloc()

  try {
    const boundaries = [boundary]
    let content_id
    let yielded = 0
    const requests = []
    let idCount = 0

    parser.onIncoming = function (req /*, keepAlive */) {
      // Boundaries encoded as HEAD request
      if (req.method === 'HEAD') {
        if (`/${boundaries.at(-1)}` !== req.url) {
          // TODO: error ?
        }
        // Leave current boundary
        if (`/${boundaries.at(-1)}--` === req.url) {
          boundaries.pop()
        }
        const newBoundary = getBoundary(req)
        if (newBoundary) boundaries.push(newBoundary)
        content_id = req.headers['content-id']
        return
      }

      const wrapper = new PassThrough()
      req.pipe(wrapper)

      const request = {
        id: `r${++idCount}`,
        url: req.url,
        method: req.method,
        headers: { ...req.headers },
        body: streamConsumers.json(wrapper).catch(() => {})
      }

      const dependencies = [...req.url.matchAll(/^\/?\$([\d.\-_~a-zA-Z]+)/g)]
      if (dependencies.length) {
        request.dependsOn = []
        for (const dependency of dependencies) {
          const dependencyId = dependency[1]
          const dependsOnRequest = requests.findLast(r => r.content_id == dependencyId) //> prefer content-id
          if (!dependsOnRequest) {
            continue
          }
          request.dependsOn.push(dependsOnRequest.id)
          request.url = request.url.replace(`$${dependencyId}`, `$${dependsOnRequest.id}`)
        }
        if (request.url[1] === '$') request.url = request.url.slice(1)
      }

      if (boundaries.length > 1) request.atomicityGroup = boundaries.at(-1)
      if (content_id) request.content_id = content_id

      requests.push(request)
    }

    if (MAX_BATCH_HEADER_SIZE == null) {
      MAX_BATCH_HEADER_SIZE = cds.env.odata.max_batch_header_size
      if (typeof MAX_BATCH_HEADER_SIZE === 'string') {
        // eslint-disable-next-line no-extra-boolean-cast
        MAX_BATCH_HEADER_SIZE = !!Number(MAX_BATCH_HEADER_SIZE)
          ? Number(MAX_BATCH_HEADER_SIZE)
          : _normalizeSize(MAX_BATCH_HEADER_SIZE)
      }
      if (typeof MAX_BATCH_HEADER_SIZE !== 'number') {
        LOG._warn &&
          LOG.warn(
            `Invalid value "${cds.env.odata.max_batch_header_size}" for configuration 'cds.odata.max_batch_header_size'. Using default value of 64 KiB.`
          )
        MAX_BATCH_HEADER_SIZE = 64 * 1024
      }
    }

    parser.initialize(HTTPParser.REQUEST, { type: 'HTTPINCOMINGMESSAGE' }, MAX_BATCH_HEADER_SIZE)

    if (typeof body === 'string') body = [body]

    const process = chunk => {
      let changed = chunk
        .toString()
        .replace(/^--(.*)$/gm, (_, g) => `HEAD /${g} HTTP/1.1${g.slice(-2) === '--' ? CRLF : ''}`)
        // correct content-length for non-HEAD requests is inserted below
        .replace(/content-length: \d+\r\n/gim, '') // if content-length is given it should be taken
        .replace(/ \$/g, ' /$')

      // HACKS!!!
      // ensure URLs start with slashes
      changed = changed.replaceAll(/\r\n(GET|PUT|POST|PATCH|DELETE) (\w)/g, `\r\n$1 /$2`)
      // add content-length headers
      changed = changed
        .split(CRLF + CRLF)
        .map((line, i, arr) => {
          if (/^(PUT|POST|PATCH) /.test(line) && !/content-length/i.test(line)) {
            const body = arr[i + 1].split('\r\nHEAD')[0]
            if (body) return `${line}${CRLF}content-length: ${Buffer.byteLength(body)}`
          }
          return line
        })
        .join(CRLF + CRLF)
      // remove strange "Group ID" appendix
      changed = changed.split(`${CRLF}Group ID`)[0] + CRLF

      let ret = parser.execute(Buffer.from(changed))

      if (typeof ret !== 'number') {
        if (ret.code === 'HPE_HEADER_OVERFLOW') {
          // same error conversion as node http server
          ret.status = 431
          ret.code = '431'
          ret.message = 'Request Header Fields Too Large'
        } else if (ret.message === 'Parse Error') {
          ret.statusCode = 400
          ret.message = `Error while parsing batch body at position ${ret.bytesParsed}: ${ret.reason}`
        }
        throw ret
      }
    }

    let leftover = ''
    for await (let chunk of body) {
      // Ensure that the whole boundary is inside the current chunk
      chunk = `${leftover}${chunk}`
      const lastBoundary = chunk.lastIndexOf('--')
      const lastCRLF = chunk.lastIndexOf(CRLF)
      if (lastBoundary > lastCRLF && lastBoundary + 2 < chunk.length) {
        leftover = chunk.slice(lastBoundary)
        chunk = chunk.slice(0, lastBoundary)
      } else {
        leftover = ''
      }
      process(chunk)

      // Drain request
      for (; yielded < requests.length; yielded++) {
        // TODO: remove should be consumed by protocol adapter itself
        requests[yielded].body = await requests[yielded].body
        if (requests[yielded].body === undefined) {
          delete requests[yielded].body
        }
        yield requests[yielded]
      }
    }

    // Process any leftovers
    if (leftover) {
      process(leftover)

      // Drain request
      for (; yielded < requests.length; yielded++) {
        // TODO: remove should be consumed by protocol adapter itself
        requests[yielded].body = await requests[yielded].body
        if (requests[yielded].body === undefined) {
          delete requests[yielded].body
        }
        yield requests[yielded]
      }
    }
  } finally {
    freeParser(parser)
  }
}

// Normalize
module.exports = async (body, boundary) => {
  const ret = {
    requests: []
  }

  // This logic would ultimately be inside the json batch processor
  // for await supports both async iterator and normal iterators (e.g. any Array)
  for await (const request of Readable.from(_parseStream(body, boundary))) {
    ret.requests.push(request)
  }

  return ret
}

module.exports._normalizeSize = _normalizeSize
module.exports._clearMaxBatchHeaderSize = () => {
  MAX_BATCH_HEADER_SIZE = null
}
