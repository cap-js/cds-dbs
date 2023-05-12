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
    'cds.hana.ST_GEOMETRY': { type: 'cds.String' }
  }
})
Object.assign(module.exports.builtin.types, hana.definitions)


const cdsTest = module.exports.test

// REVISIT: move this logic into cds when stabilized
// Overwrite cds.test with autoIsolation logic
module.exports.test = Object.setPrototypeOf(function () {
  const ret = cdsTest(...arguments)

  ret.data.isolate = ret.data.isolate || async function(db) {
    if (!db) db = await ret.cds.connect.to('db')

    // If database driver supports database and tenant isolation run test in isolation
    if(typeof db.database === 'function' && typeof db.tenant === 'function') {
      const {createHash} = require('crypto')
      const hash = createHash('sha1')
      hash.update(expect.getState?.()?.testPath || 'test_tenant')
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
    }
  }

  ret.data.autoIsolation = ret.data.autoIsolation || function(enabled) { this._autoIsolation = enabled; return this}
  ret.data.autoIsolation(true)

  before(async () => {
    if (ret.data._autoIsolation) await ret.data.isolate()
  })

  beforeAll (async () => {
    if (ret.data._autoIsolation && !ret.data._deployed) ret.data._deployed = await ret.cds.deploy(global.cds.options.from[0])
  })

  after(async () => {
    // Clean database connection pool
    return ret.cds.db?.disconnect?.()
  })

  return ret
}, cdsTest.constructor.prototype)
