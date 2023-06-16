const hdb = require('hdb')

const { driver } = require('./base')

class HDBDriver extends driver {
  /**
   * Instantiates the HDBDriver class
   * @param {import('./base').Credentials} creds The credentials for the HDBDriver instance
   */
  constructor(creds) {
    super(creds)
    this._native = hdb.createClient(creds)
    this._native.setAutoCommit(false)

    this.connected = false
  }
}

module.exports.driver = HDBDriver
