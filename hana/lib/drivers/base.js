/**
 * Base class for the HANA native driver wrapper
 */
class HANADriver {
  /**
   * Instantiates the HANADriver class
   * @param {string} creds The credentials for the HANADriver instance
   */
  constructor(creds) {
    this._creds = creds
    this.connected = false
  }

  /**
   * Generic prepare implementation for the native HANA drivers
   * @param {string} sql The SQL string to be prepared
   * @returns {import('@cap-js/db-service/lib/SQLService').PreparedStatement}
   */
  async prepare(sql) {
    const prep = prom(this._native, 'prepare')(sql)
    return {
      _prep: prep,
      run: async values => {
        const stmt = await prep
        return {
          changes: await prom(stmt, 'exec')(values),
        }
      },
      get: async values => {
        const stmt = await prep
        return (await prom(stmt, 'exec')(values))[0]
      },
      all: async values => {
        const stmt = await prep
        return prom(stmt, 'exec')(values)
      },
    }
  }

  /**
   * Used to execute simple SQL statement like BEGIN, COMMIT, ROLLBACK
   * @param {string} sql The SQL String to be executed
   * @returns {Promise<any>} The result from the database driver
   */
  async exec(sql) {
    await this.connected
    return prom(this._native, 'exec')(sql)
  }

  /**
   * Commits the current transaction
   */
  async commit() {
    await this.connected
    return prom(this._native, 'commit')()
  }

  /**
   * Rolls back the current transaction
   */
  async rollback() {
    await this.connected
    return prom(this._native, 'rollback')()
  }

  /**
   * Connects the driver using the provided credentials
   * @returns {Promise<any>}
   */
  async connect() {
    this.connected = prom(this._native, 'connect')(this._creds)
    return this.connected
  }

  /**
   * Disconnects the driver when connected
   * @returns {Promise<any}
   */
  async disconnect() {
    if (this.connected) {
      await this.connected
      this.connected = false
      return prom(this._native, 'disconnect')()
    }
  }
}

/**
 * Converts native database function calls to promises
 * util.promisify cannot be used as .bind() does not work with the HANA driver functions
 * @param {Object} dbc HANA native driver to call the function on
 * @param {String} func The name of the function to be called
 * @returns {Promise<Object>}
 */
const prom = function (dbc, func) {
  return function (...args) {
    const stack = {}
    Error.captureStackTrace(stack)
    return new Promise((resolve, reject) => {
      dbc[func](...args, (err, res, output) => {
        if (err) {
          return reject(Object.assign(err, stack, { sql: typeof args[0] === 'string' ? args[0] : null }))
        }
        resolve(output || res)
      })
    })
  }
}

const handleLevel = function (levels, path, expands) {
  let buffer = ''
  // Find correct level for the current row
  while (levels.length) {
    const level = levels[levels.length - 1]
    // Check if the current row is a child of the current level
    if (path.indexOf(level.path) === 0) {
      // Check if the current row is an expand of the current level
      const property = path.slice(level.path.length + 2, -7)
      if (property && property in level.expands) {
        const is2Many = level.expands[property]
        delete level.expands[property]
        if (level.hasProperties) {
          buffer += ','
        } else {
          level.hasProperties = true
        }
        if (is2Many) {
          buffer += `${JSON.stringify(property)}:[`
        } else {
          buffer += `${JSON.stringify(property)}:`
        }
        levels.push({
          index: 1,
          suffix: is2Many ? ']' : '',
          path: path.slice(0, -6),
          expands,
        })
      }
      // Current row is on the same level now so incrementing the index
      // If the index was not 0 it should add a comma
      if (level.index++) buffer += ','
      levels.push({
        index: 0,
        suffix: '}',
        path: path,
        expands,
      })
      break
    } else {
      // Step up if it is not a child of the current level
      const level = levels.pop()
      const leftOverExpands = Object.keys(level.expands)
      // Fill in all missing expands
      if (leftOverExpands.length) {
        buffer += leftOverExpands.map(p => `${JSON.stringify(p)}:${JSON.stringify(level.expands[p])}`).join(',')
      }
      if (level.suffix) buffer += level.suffix
    }
  }
  return buffer
}

module.exports.driver = HANADriver
module.exports.prom = prom
module.exports.handleLevel = handleLevel

// REVISIT: Ensure that all credential options are properly mapped by all drivers
/**
 * Known HANA driver credentials
 * @typedef {Object} Credentials
 * @property {string} user The username to be used
 * @property {string} password The password of the user
 * @property {string} schema The schema of the connection
 * @property {string} host The host of the HANA
 * @property {string|number} port The port of the HANA
 * @property {boolean} useTLS Whether to use TLS for the connection
 * @property {boolean} encrypt Whether to encrypt the connection
 * @property {boolean} sslValidateCertificate Whether the ssl certificate has to be valid
 * @property {boolean} disableCloudRedirect Whether the HANA is using cloud redirect
 */
