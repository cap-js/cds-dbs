const { Readable, PassThrough, Stream } = require('stream')
const { StringDecoder } = require('string_decoder')

const hdb = require('hdb')
const iconv = require('iconv-lite')

const { driver, prom, handleLevel } = require('./base')

class HDBDriver extends driver {
  /**
   * Instantiates the HDBDriver class
   * @param {import('./base').Credentials} creds The credentials for the HDBDriver instance
   */
  constructor(creds) {
    creds = {
      useCesu8: false,
      rejectUnauthorized: !!creds.sslValidateCertificate,
      fetchSize: 1 << 16, // V8 default memory page size
      useTLS: creds.useTLS || creds.encrypt,
      ...creds,
    }
    super(creds)
    this._native = hdb.createClient(creds)
    this._native.setAutoCommit(false)

    this.connected = false
  }

  set(variables) {
    const clientInfo = this._native._connection.getClientInfo()
    Object.keys(variables).forEach(k => clientInfo.setProperty(k, variables[k]))
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

  async prepare(sql) {
    const ret = await super.prepare(sql)
    ret.stream = async (values, one) => {
      const stmt = await ret._prep
      const rs = await prom(stmt, 'execute')(values)
      const cols = rs.metadata
      // If the query only returns a single row with a single blob it is the final stream
      if (cols.length === 1 && cols[0].length === -1) {
        const rowStream = rs.createObjectStream()
        const { done, value } = await rowStream[Symbol.asyncIterator]().next()
        if (done || !value[cols[0].columnName]) return null
        const blobStream = value[cols[0].columnName].createReadStream()
        blobStream.on('close', () => {
          rowStream.end()
          rs.close()
        })
        return blobStream
      }
      // Create ResultSet stream from ResultSet iterator
      return Readable.from(rsIterator(rs, one))
    }
    return ret
  }

  _extractStreams(values) {
    // Removes all streams from the values and replaces them with a placeholder
    if (!Array.isArray(values)) return { values: [], streams: [] }
    const streams = []
    values = values.map((v, i) => {
      if (v instanceof Stream && !(v instanceof PassThrough)) {
        streams[i] = v
        const passThrough = new PassThrough()
        v.pipe(passThrough)
        return passThrough
      }
      return v
    })
    return {
      values,
      streams,
    }
  }
}

async function* rsIterator(rs, one) {
  // Raw binary data stream unparsed
  const raw = rs.createBinaryStream()[Symbol.asyncIterator]()

  const nativeBlobs = rs.metadata.slice(4).map(b => b.columnName)
  const levels = [
    {
      index: 0,
      suffix: one ? '' : ']',
      path: '$[',
      expands: {},
    },
  ]

  const state = {
    rs,
    levels,
    reading: 0,
    writing: 0,
    buffer: Buffer.allocUnsafe(0),
    yields: [],
    done() {
      // Validate whether the current buffer is finished reading
      if (this.buffer.byteLength <= this.reading) {
        return raw.next().then(next => {
          if (next.done || next.value.byteLength === 0) {
            return true
          }
          this.yields.push(this.buffer.slice(0, this.writing))
          // Update state
          this.buffer = next.value
          this.reading = 0
          this.writing = 0
        })
      }
    },
    ensure(size) {
      const totalSize = this.reading + size
      if (this.buffer.byteLength >= totalSize) {
        return
      }
      return raw.next().then(next => {
        if (next.done) {
          throw new Error('Trying to read more byte then are available')
        }
        // Write processed buffer to stream
        if (this.writing) this.yields.push(this.buffer.slice(0, this.writing))
        // Keep unread buffer and prepend to new buffer
        const leftover = this.buffer.slice(this.reading)
        // Update state
        this.buffer = Buffer.concat([leftover, next.value])
        this.reading = 0
        this.writing = 0
      })
    },
    read(nr) {
      this.reading += nr
    },
    write(length, encoding) {
      const bytesLeft = this.buffer.byteLength - this.reading
      if (bytesLeft < length) {
        // Copy leftover bytes
        if (encoding) {
          let slice = Buffer.from(iconv.decode(this.buffer.slice(this.reading), 'cesu8'), 'binary')
          this.prefetchDecodedSize = slice.byteLength
          const encoded = Buffer.from(encoding.write(slice))
          if (this.writing + encoded.byteLength > this.buffer.byteLength) {
            this.yields.push(this.buffer.slice(0, this.writing))
            this.yields.push(encoded)
          } else {
            this.buffer.copy(encoded, this.writing)
            this.writing += encoded.byteLength
            this.yields.push(this.buffer.slice(0, this.writing))
          }
        } else {
          this.buffer.copyWithin(this.writing, this.reading)
          this.writing += bytesLeft
          this.yields.push(this.buffer.slice(0, this.writing))
        }

        return raw.next().then(next => {
          length = length - bytesLeft
          if (next.done) {
            throw new Error('Trying to read more byte then are available')
          }
          // Update state
          this.buffer = next.value
          this.reading = 0
          this.writing = 0
          return this.write(length, encoding)
        })
      }
      if (encoding) {
        let slice = Buffer.from(iconv.decode(this.buffer.slice(this.reading, this.reading + length), 'cesu8'), 'binary')
        this.prefetchDecodedSize = slice.byteLength
        const encoded = Buffer.from(encoding.write(slice))
        const nextWriting = this.writing + encoded.byteLength
        const nextReading = this.reading + length
        if (nextWriting > this.buffer.byteLength || nextWriting > nextReading) {
          this.yields.push(this.buffer.slice(0, this.writing))
          this.yields.push(encoded)
          this.buffer = this.buffer.slice(nextReading)
          this.reading = 0
          this.writing = 0
        } else {
          this.buffer.copy(encoded, this.writing)
          this.writing += encoded.byteLength
          this.reading += length
        }
      } else {
        this.buffer.copyWithin(this.writing, this.reading, this.reading + length)
        this.writing += length
        this.reading += length
      }
    },
    inject(str) {
      str = Buffer.from(str)
      if (this.writing + str.byteLength > this.reading) {
        this.yields.push(this.buffer.slice(0, this.writing))
        this.yields.push(str)
        this.buffer = this.buffer.slice(this.reading)
        this.writing = 0
        this.reading = 0
        return
      }
      str.copy(this.buffer, this.writing)
      this.writing += str.byteLength
    },
    slice(length) {
      const ens = this.ensure(length)
      if (ens) return ens.then(() => this.slice(length))
      const ret = this.buffer.slice(this.reading, this.reading + length)
      this.reading += length
      return ret
    },
  }

  if (!one) {
    state.inject('[')
  }

  let isDone = state.done()
  if (isDone) {
    isDone = await isDone
  }
  while (!isDone) {
    // Made all functions possible promises giving a 5x speed up
    const _path = readString(state)
    const path = (typeof _path === 'string' ? _path : await _path).toString('utf-8')
    const _blobs = readString(state)
    const blobs = JSON.parse(typeof _blobs === 'string' ? _blobs : await _blobs)
    const _expands = readString(state)
    const expands = JSON.parse(typeof _expands === 'string' ? _expands : await _expands)

    state.inject(handleLevel(levels, path, expands))

    // Read and write JSON blob data
    const jsonLength = readBlob(state)
    let hasProperties = (typeof jsonLength === 'number' ? jsonLength : await jsonLength) > 2

    for (const blobColumn of nativeBlobs) {
      // Skip all blobs that are not part of this row
      if (!(blobColumn in blobs)) {
        state.read(2)
        continue
      }

      if (hasProperties) state.inject(',')
      hasProperties = true
      state.inject(`${JSON.stringify(blobColumn)}:`)

      const blobLength = readBlob(state, new StringDecoder('base64'))
      if (typeof blobLength !== 'number') await blobLength
    }

    const level = levels[levels.length - 1]
    level.hasProperties = hasProperties

    for (const y of state.yields) {
      if (y.byteLength) {
        yield y
      }
    }
    state.yields = []

    isDone = state.done()
    if (isDone) {
      isDone = await isDone
    }
  }

  state.inject(
    levels
      .reverse()
      .map(l => l.suffix)
      .join(''),
  )
  if (state.writing) {
    state.yields.push(state.buffer.slice(0, state.writing))
  }

  for (const y of state.yields) {
    if (y.byteLength) {
      yield y
    }
  }
  rs.close()
}

const readString = function (state) {
  let ens = state.ensure(1)
  if (ens) return ens.then(() => readString(state))

  let length = state.buffer[state.reading]
  let offset = 1
  switch (length) {
    case 0xff:
      throw new Error('Missing stream metadata')
    case 0xf6:
      ens = state.ensure(2)
      if (ens) return ens.then(() => readString(state))
      length = state.buffer.readInt16LE(state.reading)
      offset = 2
      break
    case 0xf7:
      ens = state.ensure(4)
      if (ens) return ens.then(() => readString(state))
      length = state.buffer.readInt32LE(state.reading)
      offset = 4
      break
    default:
  }

  // Read the string value
  state.read(offset)
  return state.slice(length)
}

const { readInt64LE } = require('hdb/lib/util/bignum.js')
const readBlob = function (state, encoding) {
  // Check if the blob is null
  let ens = state.ensure(2)
  if (ens) return ens.then(() => readBlob(state, encoding))
  if (state.buffer[state.reading + 1] & 1) {
    state.read(2)
    state.inject('null')
    return null
  }

  // Read actual chunk size
  ens = state.ensure(32)
  if (ens) return ens.then(() => readBlob(state, encoding))
  // const charLength = readInt64LE(state.buffer, state.reading + 4)
  const byteLength = readInt64LE(state.buffer, state.reading + 12)
  const locatorId = Buffer.from(state.buffer.slice(state.reading + 20, state.reading + 28).toString('hex'), 'hex')
  const length = state.buffer.readInt32LE(state.reading + 28)
  state.read(32)

  if (encoding) {
    state.inject('"')
  }

  let hasMore = length < byteLength
  const skipLast = !encoding && !hasMore
  const preFetchRead = skipLast ? length - 1 : length
  state.prefetchDecodedSize = length
  const write = state.write(preFetchRead, encoding)
  if (skipLast) {
    state.read(1)
  }

  const after = () => {
    if (encoding) {
      state.inject(encoding.end())
      state.inject('"')
    }
    return byteLength
  }

  const next = () => {
    if (hasMore) {
      return new Promise((resolve, reject) => {
        state.rs._connection.readLob(
          {
            locatorId: locatorId,
            // REVISIT: identify why large binaries are a byte to long
            offset: state.prefetchDecodedSize + 1 || length,
            length: 1 << 16,
          },
          (err, data) => {
            if (err) return reject(err)
            const isLast = data.readLobReply.isLast
            let chunk = isLast && !encoding ? data.readLobReply.chunk.slice(0, -1) : data.readLobReply.chunk
            state.inject(encoding ? encoding.write(chunk) : chunk)
            if (isLast) {
              hasMore = false
            }
            resolve()
          },
        )
      }).then(next)
    }
    return after()
  }

  if (write?.then) {
    return write.then(next)
  }

  return next()
}

module.exports.driver = HDBDriver
