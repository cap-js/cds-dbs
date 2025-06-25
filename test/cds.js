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
      const path = cds.utils.path
      const sep = path.sep
      const testSource = process.argv[1].split(`${sep}test${sep}`)[0]
      const serviceDefinitionPath = `${testSource}/test/service`
      cds.env.requires.db = {...cds.env.requires.db, ...require(serviceDefinitionPath)}
      require(testSource + '/cds-plugin')
    } catch {
      // Default to sqlite for packages without their own service
      cds.env.requires.db = {...cds.env.requires.db, ...require('@cap-js/sqlite/test/service')}
      require('@cap-js/sqlite/cds-plugin')
    }
  })

  let ret = cdsTest(...arguments)

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
