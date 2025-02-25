const { Worker } = require('worker_threads');

const _promise = function () {
  const tmp = {}
  return Object.assign(new Promise(function (resolve, reject) {
    tmp.resolve = resolve
    tmp.reject = reject
  }), tmp)
}

class SQLiteWorkerWrapper {
  constructor(...args) {
    this._counter = 0
    this._worker = new Worker(__dirname + '/SQLiteWorker.js')
    this._proms = {}
    this._ready = this._send({ args })

    this._worker.on('online', () => { })
    this._worker.on('message', (result) => {
      const prom = this._proms[result.id]
      if (result.error) {
        return prom.reject(result.error)
      }
      prom.resolve(result)
    })
  }

  async _send({ ref, fn, args }) {
    if (!ref) {
      if (this._ref) ref = this._ref
      if (this._ready) ref = (await this._ready).ref
    }
    const prom = _promise()
    const id = this._counter++
    this._proms[id] = prom
    try {
      this._worker.postMessage({ id, ref, fn, args });
    } catch (err) {
      setImmediate(() => { prom.reject(err) })
    }
    return prom
  }

  async exec(...args) {
    const { result } = this._send({ fn: 'exec', args })
    return result
  }

  async prepare(...args) {
    const { ref } = await this._send({ fn: 'prepare', args })
    return new SQLiteWorkerWrapperStmt(this, ref)
  }

  close() {
    this._worker.terminate()
  }
}

class SQLiteWorkerWrapperStmt {
  constructor(parent, ref) {
    this._parent = parent
    this._ref = ref
  }

  async run(...args) {
    const { result } = await this._parent._send({ ref: this._ref, fn: 'run', args })
    return result
  }

  async get(...args) {
    const { result } = await this._parent._send({ ref: this._ref, fn: 'get', args })
    return result
  }

  async all(...args) {
    const { result } = await this._parent._send({ ref: this._ref, fn: 'all', args })
    return result
  }
}

module.exports = SQLiteWorkerWrapper
