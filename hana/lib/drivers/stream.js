const { Readable } = require('stream')
const { handleLevel } = require('./base')

function rsNext(state, cb) {
  let done
  if (!cb) done = state.done()
  if (done?.then) return done.then(done => {
    if (done) {
      state.inject(handleLevel(state.levels, '$', {}))
      return { done }
    }
    return rsNext(state, true)
  })
  if (done) {
    state.inject(handleLevel(state.levels, '$', {}))
    return { done }
  }

  let _path = state.readString()
  // if (_path.then) _path = await _path
  const path = (_path)
  let _blobs = state.readString()
  // if (_blobs.then) _blobs = await _blobs
  const blobs = _blobs.length === 2 ? {} : JSON.parse(_blobs)
  let _expands = state.readString()
  // if (_expands.then) _expands = await _expands
  const expands = _expands.length === 2 ? {} : JSON.parse(_expands)

  state.inject(handleLevel(state.levels, path, expands))

  // REVISIT: allow streaming with both NVARCHAR and NCLOB
  // Read JSON blob data
  const value = state.readString()

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

function rsNextObjectMode(state, next) {
  if (!next) next = rsNext(state)
  if (next.then) return next.then(next => rsNextObjectMode(state, next))
  const { done, value, path, blobs, expands } = next
  if (done) return next

  const json = JSON.parse(value)

  // Convert incoming blobs into their own native Readable streams
  for (const blobColumn of state.blobs) {
    // Skip all blobs that are not part of this row
    if (!(blobColumn in blobs)) {
      state.read(2) // 2 is the number of bytes to skip the column for hdb
      continue
    }
    json[blobColumn] = state.readBlob() // Return delayed blob read stream or null
  }

  const level = state.levels.at(-1)

  // Expose expanded columns as recursive Readable streams
  for (const expandName in expands) {
    level.expands[expandName] = json[expandName] = new Readable({
      objectMode: true,
      read() {
        state.stream.resume()
      }
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

function rsNextRaw(state, next) {
  if (!next) next = rsNext(state)
  if (next.then) return next.then(next => rsNextRaw(state, next))
  const { done, value, path, blobs } = next
  if (done) return next

  // Read and write JSON blob data
  let hasProperties = value > 2

  const nextBlob = function (state, i = 0) {
    if (state.blobs.length <= i) return
    const blobColumn = state.blobs[i]

    // Skip all blobs that are not part of this row
    if (!(blobColumn in blobs)) {
      state.read(2)
      return nextBlob(state, i + 1)
    }

    if (hasProperties) state.inject(',')
    hasProperties = true
    state.inject(`${JSON.stringify(blobColumn)}:`)

    const blobLength = state.readBlob()
    if (blobLength?.then) return blobLength.then(() => nextBlob(state, i + 1))
  }

  const _return = () => {
    const level = state.levels.at(-1)
    level.hasProperties = hasProperties

    return {
      // Iterator pattern
      done,
      value,

      // Additional row information
      path,
    }
  }

  const writeBlobs = nextBlob(state, 0)
  return writeBlobs ? writeBlobs.then(_return) : _return()
}

async function rsIterator(state, one, objectMode) {
  const stream = state.stream = new Readable({
    objectMode,
    async read() {
      if (this._running) {
        this._reading++
        return
      }
      this._running = true
      this._reading = 1

      const _next = objectMode ? rsNextObjectMode.bind(null, state) : rsNextRaw.bind(null, state)
      while (this._reading > 0) {
        let result = _next()
        if (result.then) result = await result
        if (result.done) return this.push(null)
      }
      this._running = false
    }
  })
  state.levels[0].result = stream

  if (!objectMode && !one) {
    stream.push('[')
  }

  return stream
}

module.exports.resultSetStream = rsIterator