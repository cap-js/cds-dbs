/**
 * Instances of this class are constructed and returned by cds.test().
 */
class Test extends require('./axios') {

  /**
   * Allows: const { GET, expect, test } = cds.test()
   */
  test = this

  get cds() { return require('@sap/cds/lib') }
  get sleep() { return super.sleep = require('node:timers/promises').setTimeout }
  get data() { return super.data = new (require('./data'))}

  /**
   * Launches a cds server with arbitrary port and returns a subclass which
   * also acts as an axios lookalike, providing methods to send requests.
   */
  run (folder_or_cmd, ...args) {

    switch (folder_or_cmd) {
      case 'serve': break // nothing to do as all arguments are given
      case 'run': if (args.length > 0) args.unshift ('--project'); break
      default: this.in(folder_or_cmd); args.push ('--in-memory?')
    }
    const {cds} = this

    // launch cds server...
    before (async ()=>{
      process.env.cds_test_temp = cds.utils.path.resolve (cds.root,'_out',''+process.pid)
      if (!args.includes('--port')) args.push ('--port', '0')
      let { server, url } = await cds.exec (...args)
      this.server = server
      this.url = url
    })

    // gracefully shutdown cds server...
    after (()=> Promise.all([
      cds.utils.rimraf (process.env.cds_test_temp),
      cds.shutdown(),
    ]))

    return this
  }

  /**
   * Serving projects from subfolders under the root specified by a sequence
   * of path components which are concatenated with path.resolve().
   * Checks conflicts with cds.env loaded in other folder before.
   */
  in (folder, ...paths) {
    if (!folder) return this
    const {cds} = this, { isdir, local } = cds.utils
    // try to resolve folder relative to cds.root, or as a node module
    try {
      const path = require('path')
      folder = isdir (path.resolve (cds.root, folder, ...paths))
      || path.join (require.resolve (folder+'/package.json').slice(0,-13), ...paths)
    } catch {
      throw cds.error (`No such folder or package '${process.cwd()}' -> '${folder}'`)
    }
    // Check if cds.env was loaded before running cds.test in different folder
    if (process.env.CDS_TEST_ENV_CHECK) {
      const env = Reflect.getOwnPropertyDescriptor(cds,'env')?.value
      if (env && env._home !== folder && env.stack) {
        let filter = line => !line.match(/node_modules\/jest-|node:internal/)
        let err = new Error; err.message =
          `Detected cds.env loaded before running cds.test in different folder: \n` +
          `1. cds.env loaded from:  ${local(cds.env._home)||'./'} \n` +
          `2. cds.test running in:  ${local(folder)} \n\n` +
          err.stack.split('\n').filter(filter).slice(1).join('\n')
        err.stack = env.stack.split('\n').filter(filter).slice(1).join('\n')
        throw err
      }
    }
    cds.root = folder
    return this
  }

  /**
   * Method to spy on a function in an object, similar to jest.spyOn().
   */
  spy (o,f) {
    const origin = o[f]
    const fn = function (...args) {
      ++fn.called
      return origin.apply(this,args)
    }
    fn.called = 0
    fn.restore = ()=> o[f] = origin
    return o[f] = fn
  }

  /**
   * For usage in repl, e.g. var test = await cds.test()
   */
  then (resolve) {
    if (this.server) {
      resolve({ server: this.server, url: this.url })
    } else {
      this.cds.once('listening', resolve)
    }
  }

  /**
   * Captures console.log output.
   */
  log (_capture) {
    const {console} = global, {format} = require('util')
    const log = { output: '' }
    beforeAll(()=> global.console = { __proto__: console,
      log: _capture ??= (..._)=> log.output += format(..._)+'\n',
      info: _capture,
      warn: _capture,
      debug: _capture,
      trace: _capture,
      error: _capture,
      timeEnd: _capture, time: ()=>{},
    })
    afterAll (log.release = ()=>{ log.output = ''; global.console = console })
    afterEach (log.clear = ()=>{ log.output = '' })
    return log
  }

  /**
   * Silences all console log output, e.g.: CDS_TEST_SILENT=y jest/mocha ...
   */
  silent(){
    global.console = { __proto__: console,
      log: ()=>{},
      info: ()=>{},
      warn: ()=>{},
      debug: ()=>{},
      trace: ()=>{},
      error: ()=>{},
      time: ()=>{},
      timeEnd: ()=>{},
    }
    return this
  }
  /** @deprecated */ verbose(){ return this }


  /**
   * Lazily loads and returns an instance of chai
   * @type {import('chai')}
   */
  get chai() {
    if (global.chai)  return global.chai
    const chai = require('chai')
    chai.use (require('chai-subset'))
    const chaip = require('chai-as-promised')
    chai.use (chaip.default/*v8 on ESM*/ ?? chaip/*v7*/)
    return chai
    function require (mod) { try { return module.require(mod) } catch(e) {
      if (e.code === 'MODULE_NOT_FOUND')
        throw new Error (`Failed to load required package '${mod}'. Please add it thru:`
        + `\n  npm add -D chai chai-as-promised chai-subset`, {cause: e})
      else if (e.name === 'SyntaxError') // Jest stumbling over ESM
        throw new Error (`Jest failed to load ESM package '${mod}'.`
        + `\nDowngrade '${mod}' to the major version before, or use a different test runner like 'node --test'.\n`, {cause: e})
      else if (e.code === 'ERR_REQUIRE_ESM') // node --test on older Node versions
        throw new Error (`Failed to load ESM package '${mod}'. This only is supported on Node.js >= 23.`
          + `\nUpgrade your Node.js installation or downgrade '${mod}' to the major version before.\n`, {cause: e})
      else throw e
    }}
  }
  // set expect(x) { super.expect = x }
  get expect() { return this.chai.expect }
  get assert() { return this.chai.assert }
  get should() { return this.chai.should() }
}


/** @type Test & ()=>Test */
module.exports = exports = Object.assign ((..._) => (new Test).run(..._), { Test })

// Set prototype to allow usages like cds.test.in(), cds.test.log(), ...
Object.setPrototypeOf (exports, Test.prototype)


// Provide same global functions for jest and mocha
;(function _support_jest_and_mocha() {
  const runner = exports.runner = (
    global.cds?.repl || process.env.CDS_TEST_FAKE ? 'repl' :
    'beforeAll' in global ? 'jest' :
    'before' in global ? 'mocha' :
    'node-test'
  )
  global._cds_test_fixture ??= require ('./fixtures/'+runner+'.js')
  if (runner === 'node-test') describe?.('<next>', ()=>{}) //> to signal the start of a test file
  else if (runner === 'mocha' && process.env.CDS_TEST_SILENT !== 'false') exports.silent()
})()
