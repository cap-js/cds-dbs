const { parentPort } = require('worker_threads')
const sqlite = require('better-sqlite3')
const $session = Symbol('dbc.session')

const db = function (database) {
  const dbc = new sqlite(database)

  const deterministic = { deterministic: true }
  dbc.function('session_context', key => dbc?.[$session]?.[key])
  dbc.function('regexp', deterministic, (re, x) => (RegExp(re).test(x) ? 1 : 0))
  dbc.function('ISO', deterministic, d => d && new Date(d).toISOString())

  // define date and time functions in js to allow for throwing errors
  const isTime = /^\d{1,2}:\d{1,2}:\d{1,2}$/
  const hasTimezone = /([+-]\d{1,2}:?\d{0,2}|Z)$/
  const toDate = (d, allowTime = false) => {
    const date = new Date(allowTime && isTime.test(d) ? `1970-01-01T${d}Z` : hasTimezone.test(d) ? d : d + 'Z')
    if (Number.isNaN(date.getTime())) throw new Error(`Value does not contain a valid ${allowTime ? 'time' : 'date'} "${d}"`)
    return date
  }
  dbc.function('year', deterministic, d => d === null ? null : toDate(d).getUTCFullYear())
  dbc.function('month', deterministic, d => d === null ? null : toDate(d).getUTCMonth() + 1)
  dbc.function('day', deterministic, d => d === null ? null : toDate(d).getUTCDate())
  dbc.function('hour', deterministic, d => d === null ? null : toDate(d, true).getUTCHours())
  dbc.function('minute', deterministic, d => d === null ? null : toDate(d, true).getUTCMinutes())
  dbc.function('second', deterministic, d => d === null ? null : toDate(d, true).getUTCSeconds())

  dbc.cache = {}

  if (!dbc.memory) dbc.pragma('journal_mode = WAL')
  return dbc
}

const references = {}
let counter = 1

const keepTypes = { undefined: 1, prepare: 1 }
parentPort.on('message', ({ id, ref, fn, args }) => {
  try {
    const keep = fn in keepTypes
    const result = ref ? references[ref][fn](...args) : db(...args)
    if (keep) {
      const refId = counter++
      references[refId] = result
      return parentPort.postMessage({ id, ref: refId })
    }
    parentPort.postMessage({ id, result })
  } catch (error) {
    parentPort.postMessage({ id, error })
  }
});
