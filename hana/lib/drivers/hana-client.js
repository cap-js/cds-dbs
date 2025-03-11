const { Readable, Stream } = require('stream')

const cds = require('@sap/cds')
const hdb = require('@sap/hana-client')
const { driver, prom, handleLevel } = require('./base')
const { wrap_client } = require('./dynatrace')
const LOG = cds.log('@sap/hana-client')
if (process.env.NODE_ENV === 'production' && !process.env.HDB_NODEJS_THREADPOOL_SIZE && !process.env.UV_THREADPOOL_SIZE) LOG.warn("When using @sap/hana-client, it's strongly recommended to adjust its thread pool size with environment variable `HDB_NODEJS_THREADPOOL_SIZE`, otherwise it might lead to performance issues.\nLearn more: https://help.sap.com/docs/SAP_HANA_CLIENT/f1b440ded6144a54ada97ff95dac7adf/31a8c93a574b4f8fb6a8366d2c758f21.html")

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
    creds = Object.assign({
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
    }, creds)

    // Retain node-hdb credential mappings to @sap/hana-client credential mapping
    for (const m of credentialMappings) {
      if (m.old in creds && !(m.new in creds)) creds[m.new] = creds[m.old]
    }

    super(creds)
    this._native = hdb.createConnection(creds)
    this._native = wrap_client(this._native, creds, creds.tenant)
    this._native.set = function (variables) {
      for (const key in variables) {
        this.setClientInfo(key, variables[key])
      }
    }
    this._native.setAutoCommit(false)
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
        rsStreams.catch(() => { })

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
          const cols = stmt.getColumnInfo()
          // column 0-3 are metadata columns
          const values = await Promise.all([getValue(0), getValue(1), getValue(2), getValue(3)])

          const row = {}
          for (let i = 0; i < cols.length; i++) {
            const col = cols[i]
            // column >3 are all blob columns
            row[col.columnName] = i > 3 ?
              rs.isNull(i)
                ? null
                : col.nativeType === 12 || col.nativeType === 13 // return binary type as simple buffer
                  ? await getValue(i)
                  : Readable.from(streamBlob(rsStreams, rs._rowPosition, i), { objectMode: false })
              : values[i]
          }

          result.push(row)
        }

        rs.reset().then(rsStreamsProm.resolve, rsStreamsProm.reject)

        return result
      }
    }

    ret.run = async params => {
      const { values, streams } = this._extractStreams(params)
      const stmt = await ret._prep
      let changes = await prom(stmt, 'exec')(values)
      await this._sendStreams(stmt, streams)
      // REVISIT: hana-client does not return any changes when doing an update with streams
      // This causes the best assumption to be that the changes are one
      // To get the correct information it is required to send a count with the update where clause
      if (streams.length && changes === 0) {
        changes = 1
      }
      return { changes }
    }

    ret.proc = async (data, outParameters) => {
      const stmt = await ret._prep
      const rows = await prom(stmt, 'execQuery')(data)
      return this._getResultForProcedure(rows, outParameters, stmt)
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
        return Readable.from(streamBlob(rs, undefined, 0), { objectMode: false })
      }
      return Readable.from(rsIterator(rs, one), { objectMode: false })
    }
    return ret
  }

  async validate() {
    return this._native.state() === 'connected'
  }

  _getResultForProcedure(rows, outParameters, stmt) {
    const result = {}
    // build result from scalar params
    const paramInfo = stmt.getParameterInfo()
    for (let i = 0; i < paramInfo.length; i++) {
      if (paramInfo[i].direction > 1) {
        result[paramInfo[i].name] = stmt.getParameterValue(i)
      }
    }

    const resultSet = Array.isArray(rows) ? rows[0] : rows

    // merge table output params into scalar params
    const params = Array.isArray(outParameters) && outParameters.filter(md => !(md.PARAMETER_NAME in result))
    if (params && params.length) {
      for (let i = 0; i < params.length; i++) {
        const parameterName = params[i].PARAMETER_NAME
        result[parameterName] = []
        while (resultSet.next()) {
          result[parameterName].push(resultSet.getValues())
        }
        resultSet.nextResult()
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
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        if (buffer.length) await sendParameterData(i, buffer)
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

      const stream = Readable.from(streamBlob(rs, undefined, columnIndex, binaryBuffer), { objectMode: false })
      stream.setEncoding('base64')
      for await (const chunk of stream) {
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

async function* streamBlob(rs, rowIndex = -1, columnIndex, binaryBuffer) {
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

    let blobPosition = 0

    while (true) {
      const buffer = binaryBuffer || Buffer.allocUnsafe(1 << 16)
      const read = await getData(columnIndex, blobPosition, buffer, 0, buffer.byteLength)
      blobPosition += read
      if (read < buffer.byteLength) {
        yield buffer.subarray(0, read)
        break
      }
      yield buffer
    }
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
