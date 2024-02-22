const cds = require('@sap/cds/lib')
module.exports = cds

// Adding cds.hana types to cds.builtin.types
// REVISIT: Where should we put this?
const hana = cds.linked({
  definitions: {
    'cds.hana.SMALLDECIMAL': { type: 'cds.Decimal' },
    'cds.hana.SMALLINT': { type: 'cds.Int16' },
    'cds.hana.TINYINT': { type: 'cds.UInt8' },
    'cds.hana.REAL': { type: 'cds.Double' },
    'cds.hana.CHAR': { type: 'cds.String' },
    'cds.hana.CLOB': { type: 'cds.String' },
    'cds.hana.NCHAR': { type: 'cds.String' },
    'cds.hana.BINARY': { type: 'cds.String' },
    'cds.hana.ST_POINT': { type: 'cds.String' },
    'cds.hana.ST_GEOMETRY': { type: 'cds.String' },
  },
})
Object.assign(cds.builtin.types, hana.definitions)

const cdsTest = cds.test

let isolateCounter = 0

// REVISIT: this caused lots of errors -> all is fine when I remove it
// const orgIn = cdsTest.constructor.prototype.in
// cdsTest.constructor.prototype.in = function () {
//   global.before(() => {
//     orgIn.apply(this, arguments)
//   })
//   return orgIn.apply(this, arguments)
// }

// REVISIT: move this logic into cds when stabilized
// Overwrite cds.test with autoIsolation logic
cds.test = Object.setPrototypeOf(function () {

  global.beforeAll(() => {
    try {
      const testSource = /(.*[\\/])test[\\/]/.exec(require.main.filename)?.[1]
      const serviceDefinitionPath = testSource + 'test/service.json'
      cds.env.requires.db = require(serviceDefinitionPath)
      require(testSource + 'cds-plugin')
    } catch (e) {
      // Default to sqlite for packages without their own service
      cds.env.requires.db = require('@cap-js/sqlite/test/service.json')
    }
  })

  let ret = cdsTest(...arguments)

  global.beforeAll(async () => {
    // Setup isolation after cds has prepare the project (e.g. cds.model)
    if (ret.data._autoIsolation) {
      await ret.data.isolate()
    }
  })

  let isolate = null

  ret.data.isolate =
    ret.data.isolate ||
    async function (db) {
      if (!db) db = await cds.connect.to('db')

      // If database driver supports database and tenant isolation run test in isolation
      if (typeof db.database === 'function' && typeof db.tenant === 'function') {
        const { createHash } = require('crypto')
        const hash = createHash('sha1')
        const isolateName = (require.main.filename || 'test_tenant') + isolateCounter++
        hash.update(isolateName)
        isolate = {
          // Create one database for each overall test execution
          database: process.env.TRAVIS_JOB_ID || process.env.GITHUB_RUN_ID || require('os').userInfo().username || 'test_db',
          // Create one tenant for each test suite
          tenant: 'T' + hash.digest('hex'),
        }

        // Create new database isolation
        await db.database(isolate)

        // Create new tenant isolation in database
        await db.tenant(isolate)

        ret.credentials = db.options.credentials
      }
    }

  ret.data.autoIsolation =
    ret.data.autoIsolation ||
    function (enabled) {
      this._autoIsolation = enabled
      return this
    }
  ret.data.autoIsolation(true)

  global.beforeAll(async () => {
    if (ret.data._autoIsolation && !ret.data._deployed) {
      ret.data._deployed = cds.deploy(cds.options.from[0])
      await ret.data._deployed
    }
  })

  global.afterAll(async () => {
    // Clean database connection pool
    await cds.db?.disconnect?.()

    // Clean cache
    delete cds.services._pending.db
    delete cds.services.db
    delete cds.db
    delete cds.model
    global.cds.resolve.cache = {}
  })

  return ret
}, cdsTest.constructor.prototype)

// Release cds._context for garbage collection
global.afterEach(() => {
  cds._context.disable()
})
