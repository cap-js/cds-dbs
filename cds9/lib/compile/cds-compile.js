/**
 * This is the central API facade to call compiler functions.
 */
const compile = module.exports = Object.assign (cds_compile, {

  for: new class {
    get java(){ return super.java = require('./for/java') }
    get nodejs() { return super.nodejs = require('./for/nodejs') }
    get lean_drafts() { return super.lean_drafts = require('./for/lean_drafts') }
    get odata() { return super.odata = require('./for/odata') }
    get sql() { return super.sql = require('./for/sql') }
  },

  to: new class {
    get csn() { return super.csn = require('./to/csn') }
    get cdl() { return super.cdl = require('./to/cdl') }
    get yml() { return super.yml = require('./to/yaml') }
    get yaml() { return super.yaml = require('./to/yaml') }
    get json() { return super.json = require('./to/json') }
    get edm() { return super.edm = require('./to/edm') }
    get edmx() { return super.edmx = compile.to.edm.x }
    get sql() { return super.sql = require('./to/sql') }
    get hdbcds() { return super.hdbcds = compile.to.sql.hdbcds }
    get hdbtable() { return super.hdbtable = compile.to.sql.hdbtable }
    get hana() { return super.hana = compile.to.sql.hana }
    get hdbtabledata() { return super.hdbtabledata = require('./to/hdbtabledata') }
    get serviceinfo() { return super.serviceinfo = require('./to/srvinfo') } //> REVISIT: move to CLI
  },

})



/**
 * This is the central frontend function to compile sources to CSN.
 * @param {string|string[]|{}} model one of:
 * - a single filename starting with 'file:'
 * - a single CDL source string
 * - an object with multiple CDL or CSN sources
 * - an array of one or more filenames
 * @param { _flavor | {flavor:_flavor, ...}} options
 * - an options object or a string specifying the flavor of CSN to generate
 * @param { 'inferred'|'xtended'|'parsed' } _flavor - for internal use only(!)
 * @returns {{ namespace?:string, definitions:{}, extensions?:[], meta:{ flavor:_flavor }}} CSN
 */
function cds_compile (model, options, _flavor) {
  const csn = compile.to.csn (model, options, _flavor)
  return Object.defineProperties (csn, { // fluent
    for : {configurable:true, get:()=> new Proxy ({api:compile.for,csn},_handlers)},
    to  : {configurable:true, get:()=> new Proxy ({api:compile.to, csn},_handlers)},
  })
}

const _handlers = {
  ownKeys: ({api}) => Reflect.ownKeys (api),
  get: ({api,csn},p) => {
    delete csn.for; delete csn.to //> cleanup the decorated CSN or Promise
    let fn = api[p]; if (!fn) return
    return o => 'then' in csn ? csn.then(m => fn(m,o)) : fn(csn,o)
  }
}
