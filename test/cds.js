module.exports = require('@sap/cds/lib')

// Adding cds.hana types to cds.builtin.types
// REVISIT: Where should we put this?
const hana = module.exports.linked({
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
Object.assign(module.exports.builtin.types, hana.definitions)

const cdsTest = module.exports.test

let isolateCounter = 0

const orgIn = cdsTest.constructor.prototype.in
cdsTest.constructor.prototype.in = function () {
  global.before(() => {
    orgIn.apply(this, arguments)
  })
  return orgIn.apply(this, arguments)
}

// REVISIT: move this logic into cds when stabilized
// Overwrite cds.test with autoIsolation logic
module.exports.test = Object.setPrototypeOf(function () {
  let ret

  global.before(async () => {
    try {
      const serviceDefinitionPath = /.*\/test\//.exec(require.main.filename)?.[0] + 'service.json'
      cds.env.requires.db = require(serviceDefinitionPath)
      cds.env.requires.sqlite = require('@cap-js/sqlite/test/service.json')
      cds.env.requires.postgres = require('@cap-js/postgres/test/service.json')
    } catch (e) {
      // Default to sqlite for packages without their own service
      cds.env.requires.db = require('@cap-js/sqlite/test/service.json')
    }
  })

  ret = cdsTest(...arguments)

  global.before(async () => {
    // Setup isolation after cds has prepare the project (e.g. cds.model)
    if (ret.data._autoIsolation) {
      await ret.data.isolate()
    }
  })

  const cds = ret.cds

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
        const isolate = {
          // Create one database for each overall test execution
          database: process.env.TRAVIS_JOB_ID || process.env.GITHUB_RUN_ID || 'test_db',
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
  }, 30 * 1000)

  global.afterAll(async () => {
    // Clean database connection pool
    await cds.db?.disconnect?.()

    // Clean cache
    delete cds.services._pending.db
    delete cds.services.db
    delete cds.services.sqlite
    delete cds.services.postgres
    delete cds.db
    delete cds.model
    global.cds.resolve.cache = {}
  })

  return ret
}, cdsTest.constructor.prototype)

// Release cds._context for garbage collection
global.afterEach(() => {
  module.exports._context.disable()
})
