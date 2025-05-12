const express = require('express')
const cds = require('./lib')

/**
 * Standard express.js bootstrapping, constructing an express `application`
 * and launching a corresponding http server using `app.listen()`.
 * @param {object} options - canonicalized options from `cds serve` cli
 * @param {string} options.service - name of service to be served; default: 'all'
 * @param {string} options.from - filenames of models to load; default: '*'
 * @param {boolean} options.in_memory - true if we need to bootstrap an in-memory database
 * @param {express.Handler} options.favicon - handler for /favicon.ico requests
 * @param {express.Handler} options.index - handler for generated /index.html
 * @param {express.Application} options.app - optional pre-constructed express app
 * @returns {Promise<import('http').Server>} A Promise resolving to Node.js http server as returned by express' `app.listen()`.
 */
module.exports = async function cds_server (options) {

  // prepare express app
  const o = { ...options, __proto__:defaults }

  // handle cluster mode
  let WORKERS = o.workers || process.env.WORKERS || process.env.CDS_WORKERS
  if (WORKERS) {

    const LOG = cds.log('cluster|server')
    const cluster = require('cluster')
    if (cluster.isMaster) {
      if (WORKERS in {true:1}) WORKERS = require('os').availableParallelism()
      LOG.info (`Spawning ${WORKERS} workers...`)
      for (let i=0; i < WORKERS; ) cluster.fork ({ id: ++i })
      return { on(){}, once(){}, close(){} } // dummy http server
    }

    else LOG.info(`Worker ${process.env.id} started - pid: ${process.pid}`)
    // and continue boostrapping cds.server below...
  }

  const app = cds.app = o.app || express()
  cds.emit ('bootstrap', app)

  // mount static resources and cors middleware
  if (o.cors)      app.use (o.cors)                     //> if not in prod
  if (o.health)    app.get ('/health', o.health)
  if (o.static)    app.use (express.static (o.static))  //> defaults to ./app
  if (o.favicon)   app.use ('/favicon.ico', o.favicon)  //> if none in ./app
  if (o.index)     app.get ('/',o.index)                //> if none in ./app

  // load and prepare models
  const csn = await cds.load(o.from||'*',o)
  cds.edmxs = cds.compile.to.edmx.files (csn)
  cds.model = cds.compile.for.nodejs (csn)

  // connect to essential framework services
  if (cds.requires.db) cds.db = await cds.connect.to ('db') .then (_init)
  if (cds.requires.messaging)   await cds.connect.to ('messaging')

  // serve all services declared in models
  await cds.serve (o.service,o) .in (app)
  await cds.emit ('served', cds.services)

  // start http server
  const port = o.port !== undefined ? o.port : ( process.env.PORT || cds.env.server?.port || 4004 )
  return app.server = app.listen (port)

  // cds.deploy in-memory db, if enabled
  async function _init (db) {
    if (!o.in_memory || cds.requires.multitenancy) return db
    const fts = cds.requires.toggles && cds.resolve (cds.env.features.folders)
    const m = !fts ? csn : await cds.load([o.from||'*',...fts],o) .then (cds.minify)
    return cds.deploy(m).to(db,o)
  }
}


/**
 * Default options, which can be overidden by options passed to cds.server().
 */
const defaults = {
  get static() {
    return cds.utils.isdir (cds.env.folders.app)
  },
  get index() {
    if (!cds.env.server.index)  return undefined
    const index = require ('./app/index.js')
    return (_,res) => res.send (index.html)
  },
  get favicon() {
    const favicon = require.resolve ('./app/favicon.ico')
    return express.static (favicon, {maxAge:'14d'})
  },
  get cors() {
    if (!cds.env.server.cors)  return undefined
    return function cds_cors (req, res, next) {
      const { origin } = req.headers
      if (origin) {
        res.set('access-control-allow-origin', origin)
        if (req.method === 'OPTIONS') return res.set('access-control-allow-methods', 'GET,HEAD,PUT,PATCH,POST,DELETE').end()
      }
      next()
    }
  },
  get health() {
    return (_, res) => res.json({ status: 'UP' })
  }
}


/**
 * Helper to delegate to imported UIs. Usage:
 * @example app.serve('/bookshop').from('@capire/bookshop','app/vue')
 */
express.application.serve = function (endpoint) { return { from: (pkg,folder) => {
  folder = !folder ? pkg : cds.utils.path.resolve (require.resolve(pkg+'/package.json',{paths:[cds.root]}),'../'+folder)
  this.use (endpoint, express.static(folder))
  if (!endpoint.endsWith('/webapp')) (this._app_links ??= []) .push (endpoint)
}}}
