const { Readable, Stream, promises: { pipeline } } = require('stream')
const { StringDecoder } = require('string_decoder')
const { text } = require('stream/consumers')

const cds = require('@sap/cds')
const hdb = require('hdb')
const iconv = hdb.iconv

const { driver, prom, handleLevel } = require('./base')
const { resultSetStream } = require('./stream')
const { wrap_client } = require('./dynatrace')

const credentialMappings = [
  { old: 'certificate', new: 'ca' },
  { old: 'encrypt', new: 'useTLS' },
  { old: 'sslValidateCertificate', new: 'rejectUnauthorized' },
  { old: 'validate_certificate', new: 'rejectUnauthorized' },
]

class HDBDriver extends driver {
  /**
   * Instantiates the HDBDriver class
   * @param {import('./base').Credentials} creds The credentials for the HDBDriver instance
   */
  constructor(creds) {
    creds = {
      fetchSize: 1 << 16, // V8 default memory page size
      compress: false, // compression is disabled by default to avoic cpu overhead
      ...creds,
    }

    // Retain hana credential mappings to hdb / node credential mapping
    for (const m of credentialMappings) {
      if (m.old in creds && !(m.new in creds)) creds[m.new] = creds[m.old]
    }

    super(creds)
    this._native = hdb.createClient(creds)
    this._native = wrap_client(this._native, creds, creds.tenant)
    this._native.setAutoCommit(false)
    this._native.on('close', () => this.destroy?.())
    this._native.set = function (variables) {
      const clientInfo = this._connection.getClientInfo()
      for (const key in variables) {
        clientInfo.setProperty(key, variables[key])
      }
    }

    this.connected = false
  }

  async validate() {
    return this._native.readyState === 'connected'
  }

  /**
   * Connects the driver using the provided credentials
   * @returns {Promise<any>}
   */
  async connect() {
    this.connected = prom(this._native, 'connect')(this._creds)
    return this.connected.then(async () => {
      const [version] = await Promise.all([
        prom(this._native, 'exec')('SELECT VERSION FROM "SYS"."M_DATABASE"'),
        this._creds.schema && prom(this._native, 'exec')(`SET SCHEMA ${this._creds.schema}`),
      ])
      const split = version[0].VERSION.split('.')
      this.server = {
        major: split[0],
        minor: split[2],
        patch: split[3],
      }
    })
  }

  async prepare(sql, hasBlobs) {
    const ret = await super.prepare(sql)

    if (hasBlobs) {
      ret.all = async (values) => {
        const stmt = await ret._prep
        // Create result set
        const rs = await prom(stmt, 'execute')(values)
        const cols = rs.metadata.map(b => b.columnName)
        const stream = rs.createReadStream()

        const result = []
        for await (const row of stream) {
          const obj = {}
          for (let i = 0; i < cols.length; i++) {
            const col = cols[i]
            // hdb returns large strings as streams sometimes
            if (col === '_json_' && typeof row[col] === 'object') {
              obj[col] = await text(row[col].createReadStream())
              continue
            }
            obj[col] = i > 3
              ? row[col] === null
                ? null
                : (
                  row[col].createReadStream?.()
                  || row[col]
                )
              : row[col]
          }
          result.push(obj)
        }
        return result
      }
    }

    ret.proc = async (data, outParameters) => {
      const rows = await ret.all(data)
      return this._getResultForProcedure(rows, outParameters)
    }

    // hyper streaming setup
    ret.stream = async (values, one, objectMode) => {
      const stmt = await ret._prep
      const message = require('hdb/lib/protocol/reply/index.js')
      const connection = stmt._connection
      const socket = connection._socket

      let ondata
      async function* slice(queue, stream) {
        // Wait for the connection queue to have arrived at the stream
        await queue

        ondata = socket._events.data
        socket.off('data', ondata) //  take full control over the tcp connection
        try {
          let segment
          let packetLength
          let packetRead = 0
          let rssize
          let streamsize
          let streamRead = 0
          const it = stream.iterator({ destroyOnReturn: false })
          for await (const chunk of it) {
            let offset = 0
            packetRead += chunk.length
            if (packetLength == null) {
              packetLength = chunk.readUInt32LE(12) + 32
              offset += 32
            }

            if (!segment) { // handle headers
              function alignLength(length, alignment) {
                if (length % alignment === 0) return length
                return length + alignment - length % alignment
              }

              const parts = chunk.readInt16LE(offset + 8)
              offset += 24
              for (let i = 0; i < parts; i++) {
                offset += alignLength(chunk.readInt32LE(offset + 8), 8) + 16
              }
              if (offset <= chunk.length) throw new Error(/HY\d*([\x20-\x7E]+)/.exec(`${chunk}`)[1])
              segment = true
            }

            if (offset < chunk.length && !streamsize) {
              let length = chunk[offset++]
              switch (length) {
                case 0xff:
                  return null
                case 0xf6:
                  length = chunk.readInt16LE(offset)
                  offset += 2
                  break
                case 0xf7:
                  length = chunk.readInt32LE(offset)
                  offset += 4
                  break
                default:
              }
              streamsize = length
            }
            if (offset < chunk.length && streamsize) {
              const part = chunk.subarray(offset)
              streamRead += part.length
              yield part // iconv.decode(part, 'cesu8')
            }
            if (packetRead >= packetLength) break
          }
          if (!streamRead) yield 'null'
        } finally {
          connection._queue.busy = false
          connection._queue.dequeue()
        }
      }

      const stream = Readable.from(slice(new Promise(resolve => {
        connection._queue.push({ run: (next) => { resolve(); next() } })
      }), socket), { objectMode: false })
      stmt.exec(values || [], (err, res) => {
        if (err) { return }
        res.close()
      })
      connection._queue.push({
        run: next => { // wait for stream request to have finished
          socket.on('data', ondata) // hand control over the tcp connection back
          next()
        }
      })

      return stream
    }
    return ret
  }

  _getResultForProcedure(rows, outParameters) {
    // on hdb, rows already contains results for scalar params
    const isArray = Array.isArray(rows)
    const result = isArray ? { ...rows[0] } : { ...rows }

    // merge table output params into scalar params
    const args = isArray ? rows.slice(1) : []
    if (args && args.length && outParameters) {
      const params = outParameters.filter(md => !(md.PARAMETER_NAME in (isArray ? rows[0] : rows)))
      for (let i = 0; i < params.length; i++) {
        result[params[i].PARAMETER_NAME] = args[i]
      }
    }

    return result
  }

  _extractStreams(values) {
    // Removes all streams from the values and replaces them with a placeholder
    if (!Array.isArray(values)) return { values: [], streams: [] }
    const streams = []
    values = values.map((v, i) => {
      if (v instanceof Stream) {
        if (this._creds.useCesu8 !== false && v.type === 'json') {
          const encode = iconv.encodeStream('cesu8')
          v.setEncoding('utf-8')
          // hdb will react to the stream error no need to handle it twice
          pipeline(v, encode).catch(() => { })
          return encode
        }

        streams[i] = v
        const iterator = v[Symbol.asyncIterator]()
        return Readable.from(iterator, { objectMode: false })
      }
      return v
    })
    return {
      values,
      streams,
    }
  }
}

module.exports.driver = HDBDriver
module.exports.driver._driver = hdb
