const repl = global.cds?.repl || {}
global.beforeAll  = global.before    = (msg,fn) => (fn||msg)()
global.afterAll   = global.after     = (msg,fn) => repl.on?.('exit',fn||msg)
global.beforeEach = global.afterEach = ()=>{}
global.describe   = ()=>{}
global.chai = {
  expect: global.expect = require('../expect')
}
