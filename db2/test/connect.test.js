const expect = require('chai').expect
const cds = require('@sap/cds')
const ibmdb = require('ibm_db')
const ConnStr = ``

describe('DB2', function () {
  describe('connect', function () {
    cds.env.requires.db = require('@cap-js/db2/test/service.json')
    console.log(cds.env)
  })
})
