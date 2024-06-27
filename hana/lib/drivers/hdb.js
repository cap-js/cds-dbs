const { Readable, Stream } = require('stream')
const { StringDecoder } = require('string_decoder')
const { text } = require('stream/consumers')

const hdb = require('hdb')
const iconv = require('iconv-lite')

const { driver, prom, handleLevel } = require('./base')

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
      useCesu8: false,
      fetchSize: 1 << 16, // V8 default memory page size
      ...creds,
    }

    // Retain hana credential mappings to hdb / node credential mapping
    for (const m of credentialMappings) {
      if (m.old in creds && !(m.new in creds)) creds[m.new] = creds[m.old]
    }

    super(creds)
    this._native = hdb.createClient(creds)
    this._native.setAutoCommit(false)
    this._native.on('close', () => this.destroy?.())

    this.connected = false
  }

  set(variables) {
    const clientInfo = this._native._connection.getClientInfo()
    for (const key in variables) {
      clientInfo.setProperty(key, variables[key])
    }
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
                  || Readable.from(echoStream(row[col]), { objectMode: false })
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

    ret.stream = async (values, one, objectMode) => {
      const stmt = await ret._prep
      const rs = await prom(stmt, 'execute')(values || [])
      return rsIterator(rs, one, objectMode)
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

function* echoStream(ret) {
  yield ret
}

async function rsNext(state, objectMode) {
  let done = state.done()
  if (done) {
    done = await done
    if (done) return { done }
  }

  const _path = readString(state)
  const path = (typeof _path === 'string' ? _path : await _path).toString('utf-8')
  const _blobs = readString(state)
  const blobs = JSON.parse(typeof _blobs === 'string' ? _blobs : await _blobs)
  const _expands = readString(state)
  const expands = JSON.parse(typeof _expands === 'string' ? _expands : await _expands)

  handleLevel(state.levels, path, expands)

  // REVISIT: allow streaming with both NVARCHAR and NCLOB
  // Read JSON blob data
  const value = readString(state, !objectMode)

  done = state.done()
  if (done) {
    done = await done
  }
  return {
    // Iterator pattern
    done,
    value,

    // Additional row information
    path,
    blobs,
    expands,
  }
}

async function rsNextObjectMode(state) {
  let { done, value, path, blobs, expands } = await rsNext(state, true)
  if (done) return { done }

  const json = JSON.parse(value)

  // Convert incoming blobs into their own native Readable streams
  for (const blobColumn of state.blobs) {
    // Skip all blobs that are not part of this row
    if (!(blobColumn in blobs)) {
      state.read(2)
      continue
    }

    let binaryStream = new Readable({
      read() {
        if (binaryStream._prefetch) {
          this.push(binaryStream._prefetch)
          binaryStream._prefetch = null
        }
        this.resume()
      }
    })
    readBlob(state, {
      end() { binaryStream.push(null) },
      write(chunk) {
        if (!binaryStream.readableDidRead) {
          binaryStream._prefetch = chunk
          binaryStream.pause()
          return new Promise((resolve, reject) => {
            binaryStream.once('error', reject)
            binaryStream.once('resume', resolve)
          })
        }
        binaryStream.push(chunk)
      }
    })
      ?.catch((err) => { if (binaryStream) binaryStream.emit('error', err) })
    json[blobColumn] = binaryStream // Return delayed blob read stream or null
  }

  const level = state.levels[state.levels.length - 1]

  // Expose expanded columns as recursive Readable streams
  for (const expandName in expands) {
    const stream = level.expands[expandName] = json[expandName] = new Readable({
      objectMode: true,
      read() {
        state.stream.resume()
      }
    })
    state.streams.push(stream)
    stream.once('end', function () {
      state.streams.filter(a => a !== stream)
    })
  }

  // Push current
  const resultStream = level.result
  resultStream.push(json)
  resultStream._reading--

  return {
    // Iterator pattern
    done,
    value: json,

    // Additional row information
    path,
  }
}

async function rsNextRaw(state) {
  const { done, value, path, blobs, expands } = await rsNext(state, true)
  if (done) return { done }

  const json = JSON.parse(readString(state))

  // Convert incoming blobs into their own native Readable streams
  for (const blobColumn of state.blobs) {
    // Skip all blobs that are not part of this row
    if (!(blobColumn in blobs)) {
      state.read(2)
      continue
    }

    let binaryStream = new Readable({
      read() {
        if (binaryStream._prefetch) {
          this.push(binaryStream._prefetch)
          binaryStream._prefetch = null
        }
        this.resume()
      }
    })
    readBlob(state, {
      end() { binaryStream.push(null) },
      write(chunk) {
        if (!binaryStream.readableDidRead) {
          binaryStream._prefetch = chunk
          binaryStream.pause()
          return new Promise((resolve, reject) => {
            binaryStream.once('error', reject)
            binaryStream.once('resume', resolve)
          })
        }
        binaryStream.push(chunk)
      }
    })
      ?.catch((err) => { if (binaryStream) binaryStream.emit('error', err) })
    json[blobColumn] = binaryStream // Return delayed blob read stream or null
  }

  const level = state.levels[state.levels.length - 1]

  // Expose expanded columns as recursive Readable streams
  for (const expandName in expands) {
    level.expands[expandName] = json[expandName] = new Readable({
      objectMode: true,
      read() { }
    })
  }

  return {
    // Iterator pattern
    done,
    value,

    // Additional row information
    path,
  }
}

async function rsIterator(rs, one, objectMode) {
  // Raw binary data stream unparsed
  const raw = rs.createBinaryStream()[Symbol.asyncIterator]()

  const blobs = rs.metadata.slice(4).map(b => b.columnName)
  const levels = [
    {
      index: 0,
      suffix: ']',
      path: '$[',
      expands: {},
    },
  ]

  const state = {
    rs,
    levels,
    blobs,
    reading: 0,
    writing: 0,
    buffer: Buffer.allocUnsafe(0),
    yields: [],
    done() {
      // Validate whether the current buffer is finished reading
      if (this.buffer.byteLength <= this.reading) {
        return raw.next().then(next => {
          if (next.done || next.value.byteLength === 0) {
            // yield for raw mode
            handleLevel(this.levels, this.levels[0].path, {})
            return true
          }
          if (this.writing) this.stream.push(this.buffer.slice(0, this.writing))
          // Update state
          this.buffer = next.value
          this.reading = 0
          this.writing = 0
        })
          .catch(() => {
            handleLevel(this.levels, this.levels[0].path, {})
            // TODO: check whether the error is early close
            return true
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
          throw new Error('Trying to read more bytes than are available')
        }
        // Write processed buffer to stream
        if (this.writing) this.stream.push(this.buffer.slice(0, this.writing))
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
            this.stream.push(this.buffer.slice(0, this.writing))
            this.stream.push(encoded)
          } else {
            this.buffer.copy(encoded, this.writing) // REVISIT: make sure this is the correct copy direction
            this.writing += encoded.byteLength
            this.stream.push(this.buffer.slice(0, this.writing))
          }
        } else {
          this.buffer.copyWithin(this.writing, this.reading)
          this.writing += bytesLeft
          this.stream.push(this.buffer.slice(0, this.writing))
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
          this.stream.push(this.buffer.slice(0, this.writing))
          this.stream.push(encoded)
          this.buffer = this.buffer.slice(nextReading)
          this.reading = 0
          this.writing = 0
        } else {
          this.buffer.copy(encoded, this.writing) // REVISIT: make sure this is the correct copy direction
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
      if (str == null) return
      str = Buffer.from(str)
      if (this.writing + str.byteLength > this.reading) {
        this.stream.push(this.buffer.slice(0, this.writing))
        this.stream.push(str)
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

  // Mostly ignore buffer manipulation for objectMode
  if (objectMode) {
    state.write = function write(length, encoding) {
      let slice = this.buffer.slice(this.reading, this.reading + length)
      this.prefetchDecodedSize = slice.byteLength
      this.reading += length
      return encoding.write(slice)
    }
    state.inject = function inject() { }
  }

  const stream = new Readable({
    objectMode,
    async read() {
      if (this._running) {
        this._reading++
        return
      }
      this._running = true
      this._reading = 1
      while (this._reading > 0) {
        let result = await (objectMode ? rsNextObjectMode(state) : rsNextRaw(state))
        if (result.done) return this.push(null)
      }
      this._running = false
    },
    // Clean up current state
    end() {
      state.inject(
        levels
          .reverse()
          .map(l => l.suffix)
          .join(''),
      )

      if (state.writing) {
        state.yields.push(state.buffer.slice(0, state.writing))
      }

      rs.close()
    }
  })
  levels[0].result = state.stream = stream
  state.streams = [state.stream]

  let isDone = state.done()
  if (isDone) {
    isDone = await isDone
  }

  return stream
}

async function* rsIteratorRaw(rs, one) {
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
          .catch(() => {
            // TODO: check whether the error is early close
            return true
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
          throw new Error('Trying to read more bytes than are available')
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
            this.buffer.copy(encoded, this.writing) // REVISIT: make sure this is the correct copy direction
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
          this.buffer.copy(encoded, this.writing) // REVISIT: make sure this is the correct copy direction
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
      if (str == null) return
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

    // REVISIT: allow streaming with both NVARCHAR and NCLOB
    // Read and write JSON blob data
    const jsonLength = readString(state, true)
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

const readString = function (state, isJson = false) {
  let ens = state.ensure(1)
  if (ens) return ens.then(() => readString(state, isJson))

  let length = state.buffer[state.reading]
  let offset = 1
  switch (length) {
    case 0xff:
      throw new Error('Missing stream metadata')
    case 0xf6:
      ens = state.ensure(2)
      if (ens) return ens.then(() => readString(state, isJson))
      length = state.buffer.readInt16LE(state.reading + offset)
      offset += 2
      break
    case 0xf7:
      ens = state.ensure(4)
      if (ens) return ens.then(() => readString(state, isJson))
      length = state.buffer.readInt32LE(state.reading + offset)
      offset += 4
      break
    default:
  }

  // Read the string value
  state.read(offset)
  if (isJson) {
    state.write(length - 1)
    state.read(1)
    return length
  }
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
