// REVISIT: enable UInt8 type
import typeCheck from '@sap/cds-compiler/lib/checks/checkForTypes.js'
typeCheck.type = function () { }

// REVISIT: enable cds.hana types
import typeMapping from '@sap/cds-compiler/lib/render/utils/common.js'
typeMapping.cdsToSqlTypes.postgres = {
  ...typeMapping.cdsToSqlTypes.postgres,
  // Fill in failing cds.hana types for postgres
  'cds.hana.CLOB': 'BYTEA',
  'cds.hana.BINARY': 'BYTEA',
  'cds.hana.TINYINT': 'SMALLINT',
  'cds.hana.ST_POINT': 'POINT',
  'cds.hana.ST_GEOMETRY': 'POLYGON',
}

import cds from '@sap/cds'
export default cds

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
  global.beforeAll(async () => {
    try {
      const path = cds.utils.path
      const sep = path.sep
      const testSource = process.argv[1].split(`${sep}test${sep}`)[0]
      const serviceDefinitionPath = `${testSource}/test/service`
      cds.env.requires.db = {...cds.env.requires.db, ...(await import(serviceDefinitionPath)).default}
      await import(testSource + '/cds-plugin')
    } catch {
      // Default to sqlite for packages without their own service
      cds.env.requires.db = {...cds.env.requires.db, ...(await import('@cap-js/sqlite/test/service')).default}
      await import('@cap-js/sqlite/cds-plugin')
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
        ret.data.isolation = isolate = {
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

    if (isolate) {
      await cds.db?.tenant?.(isolate, true)
    }

    // Clean cache
    delete cds.services._pending.db
    delete cds.services.db
    delete cds.db
    delete cds.model
    global.cds.resolve.cache = {}
  })

  ret.expect = cdsTest.expect
  return ret
}, cdsTest.constructor.prototype)

cds.test.expect = cdsTest.expect

// REVISIT: remove once sflight or cds-test is adjusted to the correct behavior
const expect = cdsTest.expect().__proto__.constructor.prototype
const _includes = expect.includes
expect.includes = function (x) {
  return typeof x === 'object' ? this.subset(...arguments) : _includes.apply(this, arguments)
}
