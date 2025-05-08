if (process.env.CDS_STRICT_NODE_VERSION !== 'false') require ('./utils/check-version.js')
! (global.__cds_loaded_from ??= new Set).add(__filename) // track from where we loaded cds

const { EventEmitter } = require('node:events')
const cds = module.exports = global.cds = new class cds extends EventEmitter {

  /** @import {LinkedCSN} from './core/linked-csn' */
  /** @import {Service} from './srv/cds.Service' */
  /** @type LinkedCSN */ model = undefined
  /** @type Service */ db = undefined
  /** CLI args */ cli = { command:'', options:{}, argv:[] }
  /** Working dir */ root = process.cwd()

  emit (eve, ...args) {
    if (eve === 'served') return this.listeners(eve) .reduce (
      (p,each) => p.then(()=> each.call(this,...args)),
      Promise.resolve()
    )
    else return super.emit (eve, ...args)
  }

  // Configuration & Information
  get requires() { return super.requires = this.env.requires._resolved() }
  get plugins()  { return super.plugins = require('./plugins').activate() }
  get version()  { return super.version = require('../package.json').version }
  get env()      { return super.env = require('./env/cds-env').for('cds',this.root) }
  get home()     { return super.home = __dirname.slice(0,-4) }
  get schema()   { return super.schema = require('./env/schemas') } // REVISIT: Better move that to cds-dk?

  // Loading and Compiling Models
  get compiler() { return super.compiler = require('./compile/cdsc') }
  get compile()  { return super.compile = require('./compile/cds-compile') }
  get resolve()  { return super.resolve = require('./compile/resolve') }
  get load()     { return super.load = require('./compile/load') }
  get get()      { return super.get = this.load.parsed }
  get parse()    { return super.parse = require('./compile/parse') }
  get minify()   { return super.minify = require('./compile/minify') }
  get extend()   { return super.extend = require('./compile/extend') }
  get deploy()   { return super.deploy = require('./dbs/cds-deploy') }
  get localize() { return super.localize = require('./i18n/localize') }
  get i18n()     { return super.i18n = require('./i18n') }

  // Model Reflection, Builtin types and classes
  get entities()    { return this.db?.entities || this.model?.entities }
  get reflect()     { return super.reflect = this.linked }
  get linked()      { return super.linked = require('./core/linked-csn.js') }
  get builtin()     { return super.builtin = require('./core/types.js') }
  get Association() { return super.Association = this.builtin.classes.Association }
  get Composition() { return super.Composition = this.builtin.classes.Composition }
  get entity()      { return super.entity = this.builtin.classes.entity }
  get event()       { return super.event = this.builtin.classes.event }
  get type()        { return super.type = this.builtin.classes.type }
  get array()       { return super.array = this.builtin.classes.array }
  get struct()      { return super.struct = this.builtin.classes.struct }
  get service()     { return super.service = Object.assign (this.builtin.classes.service, {
    /** @param {( this:Service, srv:Service )} fn */ impl: fn => fn,
    /** @type Service[] */ providers: []
  })}

  // Providing and Consuming Services
  /** @type { Record<string,Service> } */ services = new class {
    *[Symbol.iterator](){ for (let e in this) yield this[e] }
    get _pending(){ return this.#pending ??= {} } #pending
  }
  get server() { return super.server = require('../server.js') }
  get serve() { return super.serve = require('./srv/cds-serve') }
  get connect() { return super.connect = require('./srv/cds-connect') }
  get outboxed() { return this.queued }
  get unboxed() { return this.unqueued }
  get queued() { return super.queued = require('../libx/queue').queued }
  get unqueued() { return super.unqueued = require('../libx/queue').unqueued }
  get middlewares() { return super.middlewares = require('./srv/middlewares') }
  get odata() { return super.odata = require('../libx/odata') }
  get auth() { return super.auth = require('./auth') }
  shutdown() { this.app?.server && process.exit() } // is overridden in bin/serve.js

  // Core Services API
  get Service() { return super.Service = require('./srv/cds.Service') }
  get EventContext() { return super.EventContext = require('./req/context') }
  get Request() { return super.Request = require('./req/request') }
  get Event() { return super.Event = require('./req/event') }
  get User() { return super.User = require('./req/user') }
  get validate() { return super.validate = require('./req/validate.js') }

  // Services, Protocols and Periphery
  get ApplicationService() { return super.ApplicationService = require('../libx/_runtime/common/Service.js') }
  get MessagingService() { return super.MessagingService = require('../libx/_runtime/messaging/service.js') }
  get DatabaseService() { return super.DatabaseService = require('@cap-js/db-service').DatabaseService }
  get RemoteService() { return super.RemoteService = require('../libx/_runtime/remote/Service.js') }

  /** Contexts and Transactions @type {import('./req/context')} */
  get context()  { return this._context.getStore() }
  set context(x) { this._context.enterWith(x) }
  get spawn()    { return super.spawn = this._context.spawn }
  get _context() { return super._context = require('./req/cds-context') }

  // Helpers
  get utils() { return super.utils = require('./utils/cds-utils') }
  get error() { return super.error = require('./log/cds-error') }
  get exec() { return super.exec = require('../bin/serve').exec }
  get test() { return super.test = require('./test/cds-test') }
  get log() { return super.log = require('./log/cds-log') }
  get debug() { return super.debug = this.log.debug }
  clone(x) { return structuredClone(x) }

  // Querying and Databases
  get infer(){ return super.infer = require('./ql/cds.ql-infer.js') }
  get txs()  { return super.txs = new this.Service('cds.tx') }
  get ql()   { return super.ql = require('./ql/cds-ql') }
  tx         (..._) { return (this.db || this.txs).tx(..._) }
  run        (..._) { return (this.db || typeof _[0] === 'function' && this.txs || this.error._no_primary_db).run(..._) }
  foreach    (..._) { return (this.db || this.error._no_primary_db).foreach(..._) }
  read       (..._) { return (this.db || this.error._no_primary_db).read(..._) }
  create     (..._) { return (this.db || this.error._no_primary_db).create(..._) }
  insert     (..._) { return (this.db || this.error._no_primary_db).insert(..._) }
  update     (..._) { return (this.db || this.error._no_primary_db).update(..._) }
  upsert     (..._) { return (this.db || this.error._no_primary_db).upsert(..._) }
  delete     (..._) { return (this.db || this.error._no_primary_db).delete(..._) }
  disconnect (..._) { return (this.db || this.error._no_primary_db).disconnect(..._) }

  // Deprecated stuff to be removed in upcomming releases...
  /** @deprecated */ get lazified() { return this.lazify }
  /** @deprecated */ get lazify() { return super.lazify = require('./utils/lazify.js') }
  /** @deprecated */ get in() { return super.in = cwd => !cwd ? this : {__proto__:this, cwd, env: this.env.for('cds',cwd) } }
  /** @deprecated */ exit(code){ return this.app?.server ? this.shutdown() : process.exit(code) }
  /** @deprecated */ transaction (..._) { return (this.db||this.error._no_primary_db).transaction(..._) }
}

// Add global convenience shortcuts for cds.ql and cds.parse commands
cds.extend (global) .with ( class globals {
  get SELECT() { return Q('SELECT') }
  get INSERT() { return Q('INSERT') }
  get UPSERT() { return Q('UPSERT') }
  get UPDATE() { return Q('UPDATE') }
  get DELETE() { return Q('DELETE') }
  /** @deprecated */ get CREATE() { return D('CREATE', '{CREATE} = cds.ql', cds.ql.CREATE) }
  /** @deprecated */ get DROP() { return D('DROP', '{DROP} = cds.ql', cds.ql.DROP) }
  /** @deprecated */ get CDL() { return D('CDL', 'cds.parse.cdl', cds.parse.cdl) }
  /** @deprecated */ get CQL() { return D('CQL', 'cds.parse.cql', cds.parse.cql) }
  /** @deprecated */ get CXL() { return D('CXL', 'cds.parse.expr', cds.parse.expr) }
} .prototype )
function Q (p) { return G (p, cds.ql[p]) }
function D (old,use,fn) { return G (old, cds.utils.deprecated (fn,{kind:'Global constant',old,use})) }
function G (p,v) { Object.defineProperty (global, p, { value:v, enumerable:1,configurable:1}); return v }

// Allow for `import cds from '@sap/cds'` without `esModuleInterop` in tsconfig.json
Object.defineProperties (module.exports, { default: {value:cds}, __esModule: {value:true} })
