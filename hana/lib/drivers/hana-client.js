const hdb = require('@sap/hana-client')

const { driver } = require('./base')

class HANAClientDriver extends driver {
  /**
   * Instantiates the HANAClientDriver class
   * @param {import('./base').Credentials} creds The credentials for the HANAClientDriver instance
   */
  constructor(creds) {
    // REVISIT: make sure to map all credential properties for hana-client
    creds.currentSchema = creds.schema
    super(creds)
    this._native = hdb.createConnection(creds)
    this._native.setAutoCommit(false)
  }
}

module.exports.driver = HANAClientDriver
