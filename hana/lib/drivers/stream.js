const { Readable } = require('stream')

function rsNext(state, cb) {
  let done
  if (!cb) done = state.done()
  if (done?.then) return done.then(done => {
    if (done) return { done }
    return rsNext(state, true)
  })
  if (done) return { done }

  // REVISIT: allow streaming with both NVARCHAR and NCLOB
  // Read JSON blob data
  const value = state.readString()

  return {
    // Iterator pattern
    done,
    value,
  }
}

function rsNextObjectMode(state, next) {
  if (!next) next = rsNext(state)
  if (next.then) return next.then(next => rsNextObjectMode(state, next))
  const { done, value, path, blobs, expands } = next
  if (done) return next

  const json = JSON.parse(value)

  // Push current
  const level = state.levels.at(-1)
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
  const { done, value } = next

  state.inject(done ? ']' : ',')

  if (done) return next
  return {
    // Iterator pattern
    done,
    value,
  }
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