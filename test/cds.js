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

let isolateCounter = 0

const orgIn = cdsTest.constructor.prototype.in
cdsTest.constructor.prototype.in = function () {
  global.before(() => {
    orgIn.apply(this, arguments)
  })
}

// REVISIT: move this logic into cds when stabilized
// Overwrite cds.test with autoIsolation logic
module.exports.test = Object.setPrototypeOf(function () {
  let ret

  global.before(async () => {
    cds.requires.db = require(/.*\/test\//.exec(require.main.filename)[0] + 'service.json')

    if (ret.data._autoIsolation) {
      await ret.data.isolate()
    }
  })

  ret = cdsTest(...arguments)

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
          tenant: 'T' + hash.digest('hex')
        }

        // Create new database isolation
        await db.database(isolate)

        // Create new tenant isolation in database
        await db.tenant(isolate)

        process.stdout.write(JSON.stringify(isolate) + '\n')

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

  global.before(async () => {
    if (ret.data._autoIsolation && !ret.data._deployed) {
      ret.data._deployed = cds.deploy(cds.options.from[0])
      await ret.data._deployed
    }
  })

  global.after(async () => {
    // Clean database connection pool
    return cds.db?.disconnect?.()
  })

  return ret
}, cdsTest.constructor.prototype)
