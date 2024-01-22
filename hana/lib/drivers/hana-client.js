const { Readable, Stream } = require('stream')

const hdb = require('@sap/hana-client')
const { StringDecoder } = require('string_decoder')
const { driver, prom, handleLevel } = require('./base')

const streamUnsafe = false

const credentialMappings = [
  { old: 'schema', new: 'currentSchema' },
  { old: 'hostname_in_certificate', new: 'sslHostNameInCertificate' },
  { old: 'validate_certificate', new: 'sslValidateCertificate' },
]

class HANAClientDriver extends driver {
  /**
   * Instantiates the HANAClientDriver class
   * @param {import('./base').Credentials} creds The credentials for the HANAClientDriver instance
   */
  constructor(creds) {
    // Enable native @sap/hana-client connection pooling
    creds = Object.assign({}, creds, {
      // REVISIT: add pooling related credentials when switching to native pools
      // Enables the @sap/hana-client native connection pool implementation
      // pooling: true,
      // poolingCheck: true,
      // maxPoolSize: 100, // TODO: align to options.pool configurations

      // If communicationTimeout is not set queries will hang for over 10 minutes
      communicationTimeout: 60000,
      // connectTimeout: 1000,
      // compress: true, // TODO: test whether having compression enabled makes things faster
      // statement caches come with a side effect when the database structure changes which does not apply to CAP
      // statementCacheSize: 100, // TODO: test whether statementCaches make things faster
    })

    // Retain node-hdb credential mappings to @sap/hana-client credential mapping
    for (const m of credentialMappings) {
      if (m.old in creds && !(m.new in creds)) creds[m.new] = creds[m.old]
    }

    super(creds)
    this._native = hdb.createConnection(creds)
    this._native.setAutoCommit(false)
  }

  set(variables) {
    for (const key in variables) {
      this._native.setClientInfo(key, variables[key])
    }
  }

  async prepare(sql, hasBlobs) {
    const ret = await super.prepare(sql)
    // hana-client ResultSet API does not allow for deferred streaming of blobs
    // With the current design of the hana-client ResultSet it is only
    // possible to read all LOBs into memory to do deferred streaming
    // Main reason is that the ResultSet only allowes using getData() on the current row 
    // with the current next() implemenation it is only possible to go foward in the ResultSet
    // It would be required to allow using getDate() on previous rows
    if (hasBlobs) {
      ret.all = async (values) => {
        const stmt = await ret._prep
        // Create result set
        const reset = async function () {
          if (this) await prom(this, 'close')()
          const rs = await prom(stmt, 'executeQuery')(values)
          rs.reset = reset
          return rs
        }
        const rs = await reset()
        const rsStreamsProm = {}
        const rsStreams = new Promise((resolve, reject) => {
          rsStreamsProm.resolve = resolve
          rsStreamsProm.reject = reject
        })

        rs._rowPosition = -1
        const _next = prom(rs, 'next')
        const next = () => {
          rs._rowPosition++
          return _next()
        }
        const getValue = prom(rs, 'getValue')
        const result = []
        // Fetch the next row
        while (await next()) {
          const cols = stmt.getColumnInfo().map(b => b.columnName)
          // column 0-3 are metadata columns
          const values = await Promise.all([getValue(0), getValue(1), getValue(2), getValue(3)])

          const row = {}
          for (let i = 0; i < cols.length; i++) {
            const col = cols[i]
            // column >3 are all blob columns
            row[col] = i > 3 ?
              rs.isNull(i)
                ? null
                : Readable.from(streamBlob(rsStreams, rs._rowPosition, i, 'binary'))
              : values[i]
          }

          result.push(row)
        }

        rs.reset().then(rsStreamsProm.resolve, rsStreamsProm.reject)

        return result
      }
    }

    ret.stream = async (values, one) => {
      const stmt = await ret._prep
      values = Array.isArray(values) ? values : []
      // Uses the native exec method instead of executeQuery to initialize a full stream
      // As executeQuery does not request the whole result set at once
      // It is required to request each value at once and each row at once
      // When this is done with sync functions it is blocking the main thread
      // When this is done with async functions it is extremely slow
      // While with node-hdb it is possible to get the raw stream from the query
      // Allowing for an efficient inline modification of the stream
      // This is not possible with the current implementation of hana-client
      // Which creates an inherent limitation to the maximum size of a result set (~0xfffffffb)
      if (streamUnsafe && sql.startsWith('DO')) {
        const rows = await prom(stmt, 'exec')(values, { rowsAsArray: true })
        return Readable.from(rowsIterator(rows, stmt.getColumnInfo()), { objectMode: false })
      }
      const rs = await prom(stmt, 'executeQuery')(values)
      const cols = rs.getColumnInfo()
      // If the query only returns a single row with a single blob it is the final stream
      if (cols.length === 1 && cols[0].type === 1) {
        if (rs.getRowCount() === 0) return null
        await prom(rs, 'next')()
        if (rs.isNull(0)) return null
        return Readable.from(streamBlob(rs, undefined, 0, 'binary'), { objectMode: false })
      }
      return Readable.from(rsIterator(rs, one), { objectMode: false })
    }
    return ret
  }

  async validate() {
    return this._native.state() === 'connected'
  }

  _extractStreams(values) {
    // Removes all streams from the values and replaces them with a placeholder
    if (!Array.isArray(values)) return { values: [], streams: [] }
    const streams = []
    values = values.map((v, i) => {
      if (v instanceof Stream) {
        streams[i] = v
        return { sendParameterData: true }
      }
      return v
    })
    return {
      values,
      streams,
    }
  }

  async _sendStreams(stmt, streams) {
    // Sends all streams to the database
    const sendParameterData = prom(stmt, 'sendParameterData')
    for (let i = 0; i < streams.length; i++) {
      const curStream = streams[i]
      if (!curStream) continue
      for await (const chunk of curStream) {
        curStream.pause()
        await sendParameterData(i, Buffer.from(chunk))
        curStream.resume()
      }
      await sendParameterData(i, null)
    }
  }
}

HANAClientDriver.pool = true

async function* rsIterator(rs, one) {
  const next = prom(rs, 'next') // () => rs.next()
  const getValue = prom(rs, 'getValue') // nr => rs.getValue(nr)
  const getData = prom(rs, 'getData') // (nr, pos, buf, zero, bufSize) => rs.getData(nr, pos, buf, zero, bufSize) //
  const levels = [
    {
      index: 0,
      suffix: one ? '' : ']',
      path: '$[',
      expands: {},
    },
  ]

  const binaryBuffer = new Buffer.alloc(1 << 16)

  const blobColumns = {}
  rs.getColumnInfo()
    .slice(4)
    .forEach((c, i) => {
      blobColumns[c.columnName] = i + 4
    })

  if (!one) {
    yield '['
  }

  let buffer = ''
  // Load next row of the result set (starts before the first row)
  while (await next()) {
    const values = await Promise.all([getValue(0), getValue(1), getValue(2)])

    const [path, _blobs, _expands] = values
    const expands = JSON.parse(_expands)
    const blobs = JSON.parse(_blobs)

    yield handleLevel(levels, path, expands)

    let hasProperties = false
    let jsonPosition = 0
    while (true) {
      const read = await getData(3, jsonPosition, binaryBuffer, 0, binaryBuffer.byteLength)
      if (read < binaryBuffer.byteLength) {
        if (read > 2) hasProperties = true
        // Pipe json stream.slice(0,-1) removing the } to keep the object open
        yield binaryBuffer.slice(0, read - 1).toString('utf-8')
        break
      }
      jsonPosition += read
      yield binaryBuffer.toString('utf-8')
    }

    for (const key of Object.keys(blobs)) {
      if (hasProperties) buffer += ','
      hasProperties = true
      buffer += `${JSON.stringify(key)}:`

      const columnIndex = blobColumns[key]
      if (rs.isNull(columnIndex)) {
        buffer += 'null'
        continue
      }

      buffer += '"'
      yield buffer
      buffer = ''

      for await (const chunk of streamBlob(rs, undefined, columnIndex, 'base64', binaryBuffer)) {
        yield chunk
      }
      buffer += '"'
    }

    if (buffer) {
      yield buffer
      buffer = ''
    }

    const level = levels[levels.length - 1]
    level.hasProperties = hasProperties
  }

  // Close all left over levels
  buffer += levels
    .reverse()
    .map(l => l.suffix)
    .join('')
  yield buffer
}

async function* streamBlob(rs, rowIndex = -1, columnIndex, encoding, binaryBuffer = Buffer.allocUnsafe(1 << 16)) {
  const promChain = {
    resolve: () => { },
    reject: () => { }
  }
  try {
    // Check if the resultset is a promise
    if (rs.then) {
      // Copy the current Promise
      const prom = new Promise((resolve, reject) => rs.then(resolve, reject))
      // Enqueue all following then calls till after the current call
      const next = new Promise((resolve, reject) => {
        promChain.resolve = resolve
        promChain.reject = reject
      })
      rs.then = (resolve, reject) => next.then(resolve, reject)
      rs = await prom
    }

    // Check if the provided resultset is on the correct row
    if (rowIndex >= 0) {
      rs._rowPosition ??= -1
      if (rowIndex - rs._rowPosition < 0) {
        rs = await rs.reset()
        rs._rowPosition ??= -1
      }

      const _next = prom(rs, 'next')
      const next = () => {
        rs._rowPosition++
        return _next()
      }

      // Move result set to the correct row
      while (rowIndex - rs._rowPosition > 0) {
        await next()
      }
    }

    const getData = prom(rs, 'getData')

    let decoder = new StringDecoder(encoding)

    let blobPosition = 0

    while (true) {
      // REVISIT: Ensure that the data read is divisible by 3 as that allows for base64 encoding
      let start = 0
      const read = await getData(columnIndex, blobPosition, binaryBuffer, 0, binaryBuffer.byteLength)
      if (blobPosition === 0 && binaryBuffer.slice(0, 7).toString() === 'base64,') {
        decoder = {
          write: encoding === 'base64' ? c => c : chunk => Buffer.from(chunk.toString(), 'base64'),
          end: () => Buffer.allocUnsafe(0),
        }
        start = 7
      }
      blobPosition += read
      if (read < binaryBuffer.byteLength) {
        yield decoder.write(binaryBuffer.slice(start, read))
        break
      }
      yield decoder.write(binaryBuffer.slice(start).toString('base64'))
    }
    yield decoder.end()
  } catch (e) {
    promChain.reject(e)
  } finally {
    promChain.resolve(rs)
  }
}

async function* rowsIterator(rows, cols) {
  cols = cols.map(b => b.columnName)
  const levels = [
    {
      index: 0,
      suffix: ']',
      path: '$[',
      expands: {},
    },
  ]

  yield '['
  for (const row of rows) {
    // Made all functions possible promises giving a 5x speed up
    const path = row[0]
    const blobs = JSON.parse(row[1])
    const expands = JSON.parse(row[2])

    yield handleLevel(levels, path, expands)

    // Read and write JSON blob data
    const json = row[3]
    let hasProperties = json.length > 2
    yield json.slice(0, -1)

    for (let i = 4; i < cols.length; i++) {
      const blobColumn = cols[i]
      // Skip all blobs that are not part of this row
      if (!(blobColumn in blobs)) {
        continue
      }

      yield `${hasProperties ? ',' : ''}${JSON.stringify(blobColumn)}:`
      hasProperties = true
      yield row[i] ? `"${row[i].toString('base64')}"` : 'null'
    }

    const level = levels[levels.length - 1]
    level.hasProperties = hasProperties
  }

  yield levels
    .reverse()
    .map(l => l.suffix)
    .join('')
}

module.exports.driver = HANAClientDriver
