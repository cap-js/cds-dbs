global.test.optional = function (name, cb, timeout) {
  test(
    name,
    async function () {
      try {
        await cb.apply(this, arguments)
      } catch (err) {
        const currentTest =
          global[Object.getOwnPropertySymbols(global).find(s => global[s].currentlyRunningTest)].currentlyRunningTest
        currentTest.retryReasons.push(err)
      }
    },
    timeout,
  )
}

global.test.optional.skip = global.test.skip

require('./CSN.test')
require('./DELETE.test')
require('./INSERT.test')
require('./SELECT.test')
require('./UPDATE.test')
require('./functions.test')
require('./literals.test')
require('./timestamps.test')
require('./api.test')
