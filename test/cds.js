// REVISIT: enable UInt8 type
const typeCheck = require('@sap/cds-compiler/lib/checks/checkForTypes.js')
typeCheck.type = function () { }

// REVISIT: enable cds.hana types
const typeMapping = require('@sap/cds-compiler/lib/render/utils/common.js')
typeMapping.cdsToSqlTypes.postgres = {
  ...typeMapping.cdsToSqlTypes.postgres,
  // Fill in failing cds.hana types for postgres
  'cds.hana.CLOB': 'BYTEA',
  'cds.hana.BINARY': 'BYTEA',
  'cds.hana.TINYINT': 'SMALLINT',
  'cds.hana.ST_POINT': 'POINT',
  'cds.hana.ST_GEOMETRY': 'POLYGON',
}

const cds = require('@sap/cds')
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
      const serviceDefinitionPath = testSource + 'test/service'
      cds.env.requires.db = require(serviceDefinitionPath)
      require(testSource + 'cds-plugin')
    } catch (e) {
      // Default to sqlite for packages without their own service
      cds.env.requires.db = require('@cap-js/sqlite/test/service')
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
      if (cds.db.kind === 'hana') {
        // Consider that '-' is only allowed as timezone after ':' or 'T'
        await cds.run(`
        CREATE OR REPLACE FUNCTION ISO(RAW NVARCHAR(36))
          RETURNS RET TIMESTAMP LANGUAGE SQLSCRIPT AS
          BEGIN
            DECLARE REGEXP NVARCHAR(255);
            DECLARE TIMEZONE NVARCHAR(36);
            DECLARE MULTIPLIER INTEGER;
            DECLARE HOURS INTEGER;
            DECLARE MINUTES INTEGER;

            REGEXP := '(([-+])([[:digit:]]{2}):?([[:digit:]]{2})?|Z)$';
            TIMEZONE := SUBSTR_REGEXPR(:REGEXP IN RAW GROUP 1);
            RET := TO_TIMESTAMP(RAW);
            IF :TIMEZONE = 'Z' OR :TIMEZONE IS NULL THEN
              RETURN;
            END IF;

            MULTIPLIER := TO_INTEGER(SUBSTR_REGEXPR(:REGEXP IN TIMEZONE GROUP 2) || '1');
            HOURS := TO_INTEGER(SUBSTR_REGEXPR(:REGEXP IN TIMEZONE GROUP 3));
            MINUTES := COALESCE(TO_INTEGER(SUBSTR_REGEXPR(:REGEXP IN TIMEZONE GROUP 4)),0);

            RET := ADD_SECONDS(:RET, (HOURS * 60 + MINUTES) * 60 * MULTIPLIER * -1);
          END;
        `)
      }
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

  return ret
}, cdsTest.constructor.prototype)

// Release cds._context for garbage collection
global.afterEach(() => {
  cds._context.disable()
})
