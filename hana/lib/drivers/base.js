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
    const prep = module.exports.prom(
      this._native,
      'prepare',
    )(sql).then(stmt => {
      stmt._parentConnection = this._native
      return stmt
    })
    return {
      _prep: prep,
      run: async params => {
        const { values, streams } = this._extractStreams(params)
        const stmt = await prep
        let changes = await module.exports.prom(stmt, 'exec')(values)
        await this._sendStreams(stmt, streams)
        return { changes }
      },
      runBatch: async params => {
        const stmt = await prep
        const changes = await module.exports.prom(stmt, 'exec')(params)
        return { changes: !Array.isArray(changes) ? changes : changes.reduce((l, c) => l + c, 0) }
      },
      get: async params => {
        const stmt = await prep
        return (await module.exports.prom(stmt, 'exec')(params))[0]
      },
      all: async params => {
        const stmt = await prep
        return module.exports.prom(stmt, 'exec')(params)
      },
      drop: async () => {
        const stmt = await prep
        return stmt.drop()
      }
    }
  }

  /**
   * Extracts streams from parameters
   * @abstract
   * @param {Array[any]} params
   */
  async _extractStreams(values) {
    /**
     * @type {Array<ReadableStream>}
     */
    const streams = []
    return { values, streams }
  }

  /**
   * Sends streams to the prepared statement
   * @abstract
   * @param {import('@cap-js/db-service/lib/SQLService').PreparedStatement} stmt
   * @param {Array<ReadableStream>} streams
   */
  async _sendStreams(stmt, streams) {
    stmt
    streams
    return
  }

  /**
   * Used to execute simple SQL statement like BEGIN, COMMIT, ROLLBACK
   * @param {string} sql The SQL String to be executed
   * @returns {Promise<any>} The result from the database driver
   */
  async exec(sql) {
    await this.connected
    return module.exports.prom(this._native, 'exec')(sql)
  }

  set(variables) {
    this._native.set(variables)
  }

  /**
   * Starts a new transaction
   */
  async begin() {
    this._native.setAutoCommit(false)
  }

  /**
   * Commits the current transaction
   */
  async commit() {
    await this.connected
    return module.exports.prom(this._native, 'commit')()
  }

  /**
   * Rolls back the current transaction
   */
  async rollback() {
    await this.connected
    return module.exports.prom(this._native, 'rollback')()
  }

  /**
   * Connects the driver using the provided credentials
   * @returns {Promise<any>}
   */
  async connect() {
    this.connected = module.exports.prom(this._native, 'connect')(this._creds)
    return this.connected.then(async () => {
      const version = await module.exports.prom(this._native, 'exec')('SELECT VERSION FROM "SYS"."M_DATABASE"')
      const split = version[0].VERSION.split('.')
      this.server = {
        major: split[0],
        minor: split[2],
        patch: split[3],
      }
    })
  }

  /**
   * Disconnects the driver when connected
   * @returns {Promise<any}
   */
  async disconnect() {
    if (this.connected) {
      await this.connected
      this.connected = false
      return module.exports.prom(this._native, 'disconnect')()
    }
  }

  /**
   * Validates that the connection is connected
   * @returns {Promise<Boolean>}
   */
  async validate() {
    throw new Error('Implementation missing "validate"')
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
      dbc[func](...args, (err, ...output) => {
        if (err) {
          if (!(err instanceof Error)) {
            Object.setPrototypeOf(err, Error.prototype)
          }
          const sql = typeof args[0] === 'string' && args[0]
          // Enhance insufficient privilege errors with details
          if (err.code === 258) {
            const guid = /'[0-9A-F]{32}'/.exec(err.message)?.[0]
            const conn = dbc._parentConnection || dbc
            if (guid && conn && typeof conn.exec === 'function') {
              const getDetails = `CALL SYS.GET_INSUFFICIENT_PRIVILEGE_ERROR_DETAILS(${guid},?)`
              return conn.exec(getDetails, (e2, ...details) => {
                if (e2) return reject(enhanceError(err, stack, sql))
                const msg = `Error: ${details[details.length - 1].map(formatPrivilegeError).join('\n')}`
                reject(enhanceError(err, stack, sql, msg))
              })
            }
          }
          return reject(enhanceError(err, stack, sql))
        }
        resolve(output.length === 1 ? output[0] : output)
      })
    })
  }
}

/**
 * Converts the result from GET_INSUFFICIENT_PRIVILEGE_ERROR_DETAILS into human readable error message
 * @param {Object} row GET_INSUFFICIENT_PRIVILEGE_ERROR_DETAILS result row
 * @returns {String} What privilege is missing
 */
const formatPrivilegeError = function (row) {
  const GRANT = row.IS_MISSING_GRANT_OPTION === 'TRUE' ? 'GRANT ' : ''
  return `MISSING ${GRANT}${row.PRIVILEGE} ON ${row.SCHEMA_NAME}.${row.OBJECT_NAME}`
}

const enhanceError = function (err, stack, query, message) {
  return Object.assign(err, stack, {
    query,
    message: message ? message : err.message,
  })
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
      } else {
        // Current row is on the same level now so incrementing the index
        // If the index was not 0 it should add a comma
        if (level.index++) buffer += ','
      }
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
      if (level.suffix === '}') {
        const leftOverExpands = Object.keys(level.expands)
        // Fill in all missing expands
        if (leftOverExpands.length) {
          buffer += (level.hasProperties ? ',' : '') + leftOverExpands.map(p => `${JSON.stringify(p)}:${JSON.stringify(level.expands[p])}`).join(',')
        }
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
