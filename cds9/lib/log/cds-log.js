const cds = require('../index'), conf = cds.env.log
const log = module.exports = exports = cds_log
const path = require('path')
/* eslint-disable no-console */


/**
 * Cache used for all constructed loggers.
 */
exports.loggers = {}


/**
 * Returns a trace logger for the given module if trace is switched on for it,
 * otherwise returns null. All cds runtime packages use this method for their
 * trace and debug output. It can also be used in applications like that:
 *
 *    const LOG = cds.log('sql')
 *    LOG._info && LOG.info ('whatever', you, 'like...')
 *
 * You can also specify alternate module names:
 *
 *    const LOG = cds.log('sql|db')
 *
 * By default this logger would prefix all output with '[sql] - '.
 * You can change this by specifying another prefix in the options:
 *
 *    const LOG = cds.log('sql|db',{ prefix:'cds.ql' })
 *
 * Call cds.log() for a given module again to dynamically change the log level
 * of all formerly created loggers, for example:
 *
 *    const LOG = cds.log('sql')
 *    LOG.info ('this will show, as default level is info')
 *    cds.log('sql','warn')
 *    LOG.info ('this will be suppressed now')
 *
 * Tracing can be switched on/off through env variable DEBUG:
 * Set it to a comma-separated list of modules to switch on tracing.
 * Set it to 'all' or 'y' to switch on tracing for all modules.
 *
 * @param {string} [module] the module for which a logger is requested
 * @param {string|number|{ level, prefix }} [options] the log level to enable -> 0=off, 1=error, 2=warn, 3=info, 4=debug, 5=trace
 */
function cds_log (module, options) { // NOSONAR
  const id = module?.match(/^[^|]+/)[0] || 'cds', cache = log.loggers
  const cached = cache[id]
  if (cached && options == undefined) return cached // Note: SILENT = 0, so falsy check on option would be wrong

  let label = options?.label || options?.prefix || cached?.label || id
  let level = typeof options === 'object' ? options.level : options
  if (level == undefined) level = DEBUG_matches(module) ? DEBUG : conf.levels[id] || INFO
  if (typeof level === 'string') level = log.levels [level.toUpperCase()]
  if (cached && cached.level === level) return cached

  const logger = new Logger (label, level)
  return cache[id] = Object.assign (cached || logger.log, {
    id, label, level, setFormat(fn){ logger.format = fn; return this },
    _trace: level >= TRACE,
    _debug: level >= DEBUG,
    _info:  level >= INFO,
    _warn:  level >= WARN,
    _error: level >= ERROR,
  }, logger)
}


/**
 * Shortcut to `cds.log(...).debug`, returning undefined if `cds.log(...)._debug` is false.
 * @param {string} [module] the module for which a logger is requested
 */
exports.debug = function cds_debug (id, options) {
  const L = cds_log (id, options)
  return Object.assign((..._) => L._debug && L.debug (..._), {
    time:    label => L._debug && console.time    (`[${id}] - ${label}`),
    timeEnd: label => L._debug && console.timeEnd (`[${id}] - ${label}`),
  })
}


/**
 * Constructs a new Logger with the method signature of `{ debug, log, info, warn, error }`
 * from console. The default implementation actually maps it to `global.console`.
 * You can assign different implementations, e.g. to integrate with advanced
 * logging frameworks, for example like that:
 *
 *    cds.log.Logger = () => winston.createLogger (...)
 *
 * @param {string} [label] the module for which a logger is requested
 * @param {number} [level]  the log level to enable -> 0=off, 1=error, 2=warn, 3=info, 4=debug, 5=trace
 */
exports.Logger = (label, level) => {
  const fmt = (level,args) => logger.format (label,level,...args)
  const logger = {
    format: exports.format, // use logger.format as this could be changed dynamically
    trace:  level < DEBUG ? ()=>{} : (...args) => console.trace (...fmt(TRACE,args)),
    debug:  level < DEBUG ? ()=>{} : (...args) => console.debug (...fmt(DEBUG,args)),
    log:    level < INFO  ? ()=>{} : (...args) => console.log (...fmt(INFO,args)),
    info:   level < INFO  ? ()=>{} : (...args) => console.info (...fmt(INFO,args)),
    warn:   level < WARN  ? ()=>{} : (...args) => console.warn (...fmt(WARN,args)),
    error:  level < ERROR ? ()=>{} : (...args) => console.error (...fmt(ERROR,args)),
  }
  return logger
}
function Logger (label, level) { return exports.Logger (label, level) }


/**
 * Convenience method to construct winston loggers, very similar to `winston.createLogger()`.
 * @param {object} options - as in `winston.createLogger()`
 * @returns The winston logger, decorated with the standard cds.log methods
 * .debug(), .info(), .warn(), .error(), etc.
 */
exports.winstonLogger = (options) => (label, level) => {
  const winston = require("winston")
  const logger = winston.createLogger({
    levels: log.levels, level: Object.keys(log.levels)[level],
    transports: [new winston.transports.Console()],
    ...options
  })
  const { formatWithOptions } = require('util')
  const _fmt = ([...args]) => formatWithOptions(
    { colors: false }, `[${label}] -`, ...args
  )
  return Object.assign (logger, {
    trace: (...args) => logger.TRACE (_fmt(args)),
    debug: (...args) => logger.DEBUG (_fmt(args)),
    log:   (...args) => logger.INFO  (_fmt(args)),
    info:  (...args) => logger.INFO  (_fmt(args)),
    warn:  (...args) => logger.WARN  (_fmt(args)),
    error: (...args) => logger.ERROR (_fmt(args)),
  })
}


/**
 * Built-in formatters
 */
 const { _simple, _mt } = exports.formatters = {
  _simple: (label, level, ...args) => [ `[${label}] -`, ...args ],
  _mt: (label, level, ...args) => {
    const t = cds.context?.tenant; if (t) label += '|'+t
    return _simple (label, level, ...args)
  },
  get plain() {
    return this._plain || (this._plain = cds.requires.multitenancy ? _mt : _simple)
  },
  get json() {
    return this._json || (this._json = require('./format/json'))
  }
}


/**
 * Formats log outputs by returning an array of arguments which are passed to
 * console.log() et al.
 * You can assign custom formatters like that:
 *
 *    cds.log.format = (label, level, ...args) => [ '[', label, ']', ...args ]
 *
 * @param {string} label the label to prefix to log output
 * @param {number} level the log level to enable -> 0=off, 1=error, 2=warn, 3=info, 4=debug, 5=trace
 * @param {any[]} args  the arguments passed to Logger.debug|log|info|warn|error()
 */
exports.format = log.formatters[cds.env.log.format || 'plain']


const DEBUG_matches = (m) => process.env.DEBUG?.match(RegExp(`\\b(y|all|${m||'any'})\\b`))
const { ERROR, WARN, INFO, DEBUG, TRACE } = exports.levels = {
  SILENT:0, ERROR:1, WARN:2, INFO:3, DEBUG:4, TRACE:5, SILLY:5, VERBOSE:5
}


;(function _init() {
  const conf = cds.env.log
  if (conf.Logger) {
    let resolvedPath
    try { resolvedPath = require.resolve(conf.Logger) } catch {
      try { resolvedPath = require.resolve(path.join(cds.root, conf.Logger)) } catch {
        throw new Error(`Cannot find logger at "${conf.Logger}"`)
      }
    }
    exports.Logger = require (resolvedPath) // Use configured logger in case of cds serve
  }
  if (conf.service) {
    const {app} = cds, serveIn = app => require('./service').serveIn(app)
    app ? setImmediate(() => serveIn(app)) : cds.on('bootstrap', app => serveIn(app))
  }
})()
