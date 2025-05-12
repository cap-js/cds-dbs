#!/usr/bin/env node
module.exports = exports = Object.assign ( serve, {
    options: [
        '--service', '--from', '--to', '--at', '--with',
        '--port', '--workers',
    ],
    flags: [
        '--project', '--projects',
        '--in-memory', '--in-memory?',
        '--mocked', '--with-mocks', '--with-bindings', '--resolve-bindings',
        '--watch',
    ],
    shortcuts: [ '-s', undefined, '-2', '-a', '-w', undefined, undefined, '-p' ],
    help: `
# SYNOPSIS

    *cds serve* [ <filenames> ] [ <options> ]
    *cds serve* [  <service>  ] [ <options> ]

    Starts http servers that load service definitions from cds models and
    construct service providers, mounted to respective endpoints to serve
    incoming requests.

    If the given argument refers to existing files, an effective model
    is loaded from these files and *all services*, that are served.
    The default is '*', which loads all models from the project.

    If the given argument doesn't match an existing file, it's used
    as the name of the *single service* to serve.


# OPTIONS


    *-s | --service* <name>  (default: 'all')

        Serve a _single service_ from specified model(s).
        EXAMPLE: *cds serve --service CatalogService*

    *-f | --from* <model>    (default: '*')

        Load service definitions from specified folder(s).
        EXAMPLE: *cds serve --from srv*

    *-w | --with* <impl>

        Define which implementation to use (i.e. a _.js_ file).
        EXAMPLE: *cds serve --service CatalogService --with srv/cat-service.js*

    *-a | --at* <endpoint>

        Add endpoint to bind the service to.
        EXAMPLE: *cds serve --at localhost:3030*

    *-2 | --to* <protocol>

        Decide on the protocol (i.e. _fiori_, _odata_, or _rest_) to serve.
        EXAMPLE: *cds serve --to odata*

    *-p | --project* [<project>]

        Runs _cds serve all_ for the specified project; default: cwd.
        You can use *cds run* as shortcut.

    *--port* <number>

        Specify the port on which the launched server shall listen.
        If you specify '0', the server picks a random free port.
        Alternatively, specify the port using env variable _PORT_.

    *--watch* [<project>]

        Like *--project* but starts through _nodemon_ to restart the server
        upon changes in code or models.
        You can use *cds watch* as shortcut, which is equivalent to:
        *cds serve --with-mocks --in-memory? --watch --project ...*

    *--workers* <number> | true

        Spawns <number> of worker processes in a cluster to handle incoming requests.
        If set to 'true', the number of workers is determined by the number of CPUs.
        If omitted, the server runs in non-cluster mode as a single process.


    *--mocked*

        Use this option to launch a _single service_  in a mock server, for
        a model you imported from an external source, like an S/4 system,.
        In addition to constructing the service provider, this will bootstrap
        a transient _in-memory_ database, filled with tables corresponding
        to the signatures of the service's exposed entities.

    *--with-mocks*

        Use this in combination with the variants serving _multiple services_.
        It starts in-process mock services for all required services configured
        in _package.json#cds.requires_, which don't have external bindings
        in the current process environment.
        Note that by default, this feature is disabled in production and must be
        enabled with configuration 'features.mocked_bindings=true'.

    *--with-bindings*

        Use this option in local tests, to have all services provided by a
        process registered with their physical urls in a temporary file.
        All required services are bound automatically upon bootstrapping.
        Option *--with-mocks* subsumes this option.

    *--resolve-bindings* (beta)

        Resolve remote service bindings configured via *cds bind*.

    *--in-memory[?]*

        Automatically adds a transient in-memory database bootstrapped on
        each (re-)start in the same way *cds deploy* would do, based on defaults
        or configuration in _package.json#cds.requires.db_. Add a question
        mark to apply a more defensive variant which respects the configured
        database, if any, and only adds an in-memory database if no
        persistent one is configured.

        Requires an SQLite driver to be installed. For example: _npm i @cap-js/sqlite_.

# EXAMPLES

    *cds serve*
    *cds serve* all
    *cds serve* CatalogService *--from* app/
    *cds serve* CatalogService *--from* srv/ *--at* /cats *--to* rest
    *cds serve* all --watch --with-mocks --in-memory?
    *cds run* some/project
    *cds watch* some/project
    *cds watch*

`})


const cds = require('../lib'), { exists, isfile, local, redacted, path } = cds.utils
const COLORS = process.stdout.isTTY && !process.env.NO_COLOR || process.env.FORCE_COLOR

/* eslint-disable no-console */

// provisional loggers, see _prepare_logging
let log = console.log


/**
 * The main function which dispatches into the respective usage variants.
 * @param {string[]} all - project folder, model filenames, or service name
 */
async function serve (all=[], o={}) {

  // canonicalize options to ease subsequent tasks...
  cds.options = o
  const [pms] = all // project folder, model filenames, or service name
  if (o.from)                o.from = o.from.split(',')
  if (o.project||o.projects) { o.project = pms; o.service='all'; o.from='*' }
  else if (o.service)        { o.from    = pms ? pms.split(',') : '*'}
  else if (o.from)           { o.service = pms }
  else if (exists(pms))      { o.service ='all', o.from = all }
  else                       { o.service = pms||'all',  o.from = '*' }

  // IMPORTANT: never load any @sap/cds modules before the chdir above happened!
  // handle --watch and --project
  if (o.watch)  return _watch.call(this, o.project,o)   // cds serve --watch <project>
  if (o.project) _chdir_to (o.project)      // cds run --project <project>

  // let plugins know about the CLI
  cds.cli = { command: 'serve', argv: all, options: o }

  // Ensure loading plugins before calling cds.env!
  await cds.plugins

  const TRACE = cds.debug('trace')
  TRACE?.time('total startup time'.padEnd(22))
  if (TRACE) {
    TRACE?.time('require express'.padEnd(22))
    require('express')
    TRACE?.timeEnd('require express'.padEnd(22))
  }

  // Load local server.js early in order to allow setting custom cds.log.Loggers
  const cds_server = await _local_server_js() || cds.server
  if (!o.silent) _prepare_logging ()

  // The following things are meant for dev mode, which can be overruled by feature flags...
  const {features} = cds.env
  {
    // handle --with-mocks resp. --mocked
    if (features.with_mocks) o.mocked = _with_mocks(o)

    // handle --in-memory resp. --in-memory?
    if (features.in_memory_db) o.in_memory = _in_memory(o)

    // load service bindings when mocking or asked to
    if (features.mocked_bindings && o.mocked || o['with-bindings']) await cds.service.bindings

    // live reload, in cooperation with cds watch
    if (features.live_reload) require('../app/etc/livereload')

  }

  // bootstrap server from project-local server.js or from @sap/cds/server.js
  const server = await cds_server(o)

  // increase keep-alive timeout for CF (gorouter wants >90s)
  if (process.env.CF_INSTANCE_GUID) server.keepAliveTimeout = 91 * 1000

  // return a promise which resolves to the created http server when listening
  return cds.server.listening = new Promise ((_resolve,_reject) => {

    server.listening ? _started(server) : server.once('listening',_started)
    server.on ('error',_reject) // startup errors like EADDRINUSE
    // server.on ('close', _shutdown)  // IMPORTANT: Don't do that as that would be a very strange loop
    // process.on ('exit', _shutdown)  // IMPORTANT: Don't do that as that would be a very strange loop
    async function _started() {
      _assert_no_multi_installs()
      const url = cds.server.url = `http://localhost:${server.address().port}`
      cds.emit ('listening', {server,url}) //> inform local listeners
      _resolve ({ server, url })
    }

    const LOG = cds.log()
    cds.shutdown = _shutdown //> for programmatic invocation
    if (cds.env.server.shutdown_on_uncaught_errors && !cds.repl) {
      process.on('unhandledRejection', _shutdown) //> using std logger to have it labelled with [cds] - instead of [cli] -
      process.on('uncaughtException', _shutdown)  //> using std logger to have it labelled with [cds] - instead of [cli] -
    }
    process.on('SIGINT', cds.watched ? _shutdown : (s,n)=>_shutdown(s,n,console.log())) //> newline after ^C
    process.on('SIGHUP', _shutdown)
    process.on('SIGHUP2', _shutdown)
    process.on('SIGTERM', _shutdown)

    async function _shutdown (signal,n) {
      if (signal && n) LOG.debug ('⚡️',signal,n, 'received by cds serve')
      let err = typeof signal === 'object' ? signal : null
      if (err) {
        LOG.error('❗️Uncaught', err)
        LOG.error('❗️server shutdown ...❗️')
      }
      await Promise.all(cds.listeners('shutdown').map(fn => fn(err)))
      server.close(()=>{/* it's ok if closed already */})   // first, we try stopping server and process the nice way
      let { force_exit_timeout: force_exit } = cds.env.server // after ~1 sec, we force-exit it, unless in test mode
      if (force_exit && !global.it) setTimeout(process.exit,force_exit).unref()
    }

    if (LOG._debug) {
      cds.on('shutdown', () => LOG.debug ('⚡️','cds serve - cds.shutdown'))
      server.on('close', () => LOG.debug ('⚡️','cds serve - server.close(d)'))
      process.on('exit', () => LOG.debug ('⚡️','cds serve - process.exit'))
      process.on('beforeExit', ()=> LOG.debug ('⚡️','cds serve - process.beforeExit'))
    }

    if (process.platform === 'win32') {
      process.on('message', msg => msg.close && _shutdown())  // by `cds watch` on Windows
    }

    TRACE?.timeEnd('total startup time'.padEnd(22))
    return server
  })
}

async function _local_server_js() {
  const _local = file => isfile(file) || isfile (path.join(cds.env.folders.srv,file))
  let server_js = process.env.CDS_TYPESCRIPT && _local('server.ts') || _local('server.js')
  if (server_js) {
    console.log ('[cds] - loading server from', { file: local(server_js) })
    let fn = await cds.utils._import(server_js)
    if (fn && fn.default)  fn = fn.default  // default ESM export
    return typeof fn === 'function' ? fn : cds.server
  }
}


function _prepare_logging () { // NOSONAR

  const LOG = cds.log('cds.serve|server',{label:'cds'}); if (!LOG._info) return; else log = LOG.info
  const _timer = process.env.NODE_ENV === 'production'
    ? `[cds] - server launched at ${new Date().toLocaleString()}, version: ${cds.version}, in`
    : '[cds] - server launched in'
  console.time (_timer)

  // print information when model is loaded
  cds.on ('loaded', ({$sources:srcs})=>{
    LOG.info (`loaded model from ${srcs.length} file(s):\n${COLORS ? '\x1b[2m' : ''}`)
    const limit = 30, shown = srcs.length === limit + 1 ? limit + 1 : limit // REVISIT: configurable limit?
    for (let each of srcs.slice(0, shown))  console.log (' ', local(each))
    if (srcs.length > shown) {
      if (LOG._debug) for (let each of srcs.slice(shown))  console.log (' ', local(each))
      else console.log (`  ...${srcs.length-shown} more. Run with DEBUG=serve to show all files.`)
    }
    COLORS && console.log ('\x1b[0m')
  })

  // print information about each connected service
  cds.on ('connect', ({name,kind,options:{use,credentials,impl}})=>{
    LOG.info (`connect to ${name} > ${use||kind||impl}`, credentials ? redacted(credentials) : '')
  })

  // print information about each provided service
  cds.on ('serving', (srv) => {
    const details = {}
    if (srv._source && !srv._source.startsWith('@sap'))
      details.impl = local(srv._source)
    if (srv.endpoints.length === 1)
      details.path = srv.endpoints[0].path // for brevity, omit 'kind' if there is only one protocol
    else if (srv.endpoints.length > 1)
      details.endpoints = srv.endpoints    // full endpoint details if more than one
    LOG.info (`${srv.mocked ? 'mocking' : 'serving'} ${srv.name}`, details)
  })

  // print info when we are finally on air
  cds.once ('listening', ({url})=>{
    console.log()
    LOG.info ('server listening on',{url})
    _timer && console.timeEnd (_timer)
    if (process.stdin.isTTY) LOG.info (`[ terminate with ^C ]\n`)
  })
}

/** handles --watch option */
function _watch (project,o) {
  o.args = process.argv.slice(2) .filter (a => a !== '--watch' && a !== '-w')
  return this.load('watch')([project],o)
}


/** handles --project option */
function _chdir_to (project) {
  // try using the given project as dirname, e.g. './bookshop'
  const dir = cds.utils.isdir (project)
  if (dir) return cds.root = dir
  // try using the given project as a node package name, e.g. '@capire/bookshop'
  try { cds.root = path.dirname (require.resolve(project+'/package.json')) }
  // both failed
  catch { cds.error `No such folder or package: '${process.cwd()}' -> '${project}'` }
}


/** handles --in-memory option */
function _in_memory (o) {
  const {env} = cds, db = env.requires.db
  if (o['in-memory'] || o['in-memory?'] && !db) {
    env.add ({ requires: { db: {
      kind:'sqlite', ...env.requires.kinds.sqlite,
      credentials: db?.credentials?.url ? {url:':memory:'} : {database:':memory:'}
    }}})
    return true
  }
  if (db && db.credentials && (db.credentials.database || db.credentials.url) === ':memory:') {
    return true
  }
}


/** handles --with-mocks option */
function _with_mocks (o) {
  if (o.mocked || (o.mocked = o['with-mocks'])) {
    cds.on ('loaded', model => cds.deploy.include_external_entities_in(model))
    const mocks = cds.env.features.test_mocks && isfile ('test/mocked.js')
    if (mocks) cds.once ('served', ()=> {
      log ('adding mock behaviours from', { file: local(mocks) })
      require(mocks)
    })
    return true
  }
}

const _assert_no_multi_installs = ()=> { if (global.__cds_loaded_from?.size > 1) {
  console.error(`
-----------------------------------------------------------------------
ERROR: Package '@sap/cds' was loaded from different installations:`,
[ ...global.__cds_loaded_from ],
`\nEnsure a single install to avoid hard-to-resolve errors.
-----------------------------------------------------------------------
`);
  if (cds.env.server.exit_on_multi_install)  process.exit(1)
}}

exports.exec = function cds_serve (...argv) {
  try {
    const [ args, options ] = require('./args') (serve, argv)
    return serve (args, options)
  } catch (e) {
    console.error(e) // eslint-disable-line no-console
    process.exitCode = 1
  }
}
if (!module.parent) exports.exec (...process.argv.slice(2))
