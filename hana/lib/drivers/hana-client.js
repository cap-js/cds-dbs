const { Readable, Stream } = require('stream')

const hdb = require('@sap/hana-client')
const hdbStream = require('@sap/hana-client/extension/Stream')
const { driver, prom, handleLevel } = require('./base')

const streamUnsafe = false

class HANAClientDriver extends driver {
  /**
   * Instantiates the HANAClientDriver class
   * @param {import('./base').Credentials} creds The credentials for the HANAClientDriver instance
   */
  constructor(creds) {
    // REVISIT: make sure to map all credential properties for hana-client
    creds.currentSchema = creds.schema
    super(creds)
    this._native = hdb.createConnection(creds)
    this._native.setAutoCommit(false)
  }

  async prepare(sql) {
    let prep = prom(this._native, 'prepare')(sql)
    return {
      run: async params => {
        const stmt = await prep
        const { values, streams } = this._extractStreams(params)
        let changes = await prom(stmt, 'exec')(values)
        await this._sendStreams(stmt, streams)
        // REVISIT: hana-client does not return any changes when doing an update with streams
        // This causes the best assumption to be that the changes are one
        // To get the correct information it is required to send a count with the update where clause
        if (streams.length && changes === 0) {
          changes = 1
        }
        return { changes }
      },
      get: async values => {
        const stmt = await prep
        values = Array.isArray(values) ? values : []
        return (await prom(stmt, 'exec')(values))[0]
      },
      all: async values => {
        const stmt = await prep
        values = Array.isArray(values) ? values : []
        return prom(stmt, 'exec')(values)
      },
      stream: async (values, one) => {
        const stmt = await prep
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
          return Readable.from(rowsIterator(rows, stmt.getColumnInfo()))
        }
        const rs = await prom(stmt, 'executeQuery')(values)
        const cols = rs.getColumnInfo()
        // If the query only returns a single row with a single blob it is the final stream
        if (cols.length === 1 && cols[0].type === 1) {
          if (rs.getRowCount() === 0) return null
          await prom(rs, 'next')()
          if (rs.isNull(0)) return null
          return hdbStream.createLobStream(rs, 0, {})
        }
        return Readable.from(rsIterator(rs, one))
      },
    }
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

const useGetData = true
async function* rsIterator(rs, one) {
  const next = prom(rs, 'next') // () => rs.next()
  const getValues = prom(rs, 'getValues')
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

  const binaryBufferSize = 1 << 16
  const binaryBuffer = new Buffer.alloc(binaryBufferSize)

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
    const values = await (useGetData
      ? Promise.all([getValue(0), getValue(1), getValue(2)])
      : getValues({ asArray: true }))
    const [path, _blobs, _expands] = values
    const expands = JSON.parse(_expands)
    const blobs = JSON.parse(_blobs)

    yield handleLevel(levels, path, expands)

    let hasProperties = false
    if (useGetData) {
      let jsonPosition = 0
      while (true) {
        const read = await getData(3, jsonPosition, binaryBuffer, 0, binaryBufferSize)
        if (read < binaryBufferSize) {
          if (read > 2) hasProperties = true
          // Pipe json stream.slice(0,-1) removing the } to keep the object open
          yield binaryBuffer.slice(0, read - 1)
          break
        }
        jsonPosition += read
        yield binaryBuffer
      }
    } else {
      yield values[3].slice(0, -1)
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

      if (useGetData) {
        let blobPosition = 0
        while (true) {
          // REVISIT: Ensure that the data read is divisible by 3 as that allows for base64 encoding
          const read = await getData(columnIndex, blobPosition, binaryBuffer, 0, binaryBufferSize)
          blobPosition += read
          if (read < binaryBufferSize) {
            yield binaryBuffer.slice(0, read).toString('base64')
            break
          }
          yield binaryBuffer.toString('base64')
        }
      } else {
        yield values[columnIndex]
      }
      buffer += '"'
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
