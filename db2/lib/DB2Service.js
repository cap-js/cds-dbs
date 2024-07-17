const { SQLService } = require('@cap-js/db-service')
const ibmdb = require('ibm_db')
const cds = require('@sap/cds')
const crypto = require('crypto')
const { Writeable, Readable } = require('stream')
const DEBUG = cds.debug('sql|db')

const ISO_8601_FULL = /\'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(([+-]\d\d:\d\d)|Z)?/i

const getCredentialsForClient = (credentials, bIncludeDbName) => {
  let connString = ''
  if (bIncludeDbName) {
    connString = `${connString}DATABASE=${credentials.database};`
  }

  connString = `${connString}HOSTNAME=${credentials.host};PORT=${credentials.port};`
  if (credentials.sslrootcert) {
    connString = `${connString}Security=SSL;SSLServerCertificate=${credentials.sslrootcert};`
  }
  connString = `${connString}PROTOCOL=TCPIP;UID=${credentials.user};PWD=${credentials.password}`

  if (credentials.schema) {
    connString = `${connString};currentschema=${credentials.schema};`
  }
  return connString
}

class DB2Service extends SQLService {
  /**
   * @type{ibmdb.Database}
   */
  dbc
  init () {
    super.init(...arguments)
    if (!this.options.indendentDeploy) {
      cds.options = cds.options || {}
      cds.options.dialect = 'plain'
    }
    this.kind = 'plain'
    this._queryCache = {}

    // this.options.credentials = cds.env.requires[this.options.kind].credentials
    if (this.options.credentials && this.options.credentials.username) {
      this.options.credentials.user = this.options.credentials.username
    }

    if (this.options.credentials && this.options.credentials.hostname) {
      this.options.credentials.host = this.options.credentials.hostname
    }
    if (this.options.credentials && this.options.credentials.dbname) {
      this.options.credentials.database = this.options.credentials.dbname
    }
    if (this.options.credentials && this.options.credentials.sslrootcert) {
      if (typeof this.options.credentials.sslRequired === 'undefined') {
        this.options.credentials.sslRequired = true
      }
      this.options.credentials.ssl = {
        rejectUnauthorized: false,
        ca: this.options.credentials.sslrootcert,
      }
    }
    this.cn = getCredentialsForClient(this.options.credentials, true)
  }
  get factory () {
    return {
      // unkown options
      options: {
        min: 0,
        testOnBorrow: true,
        acquireTimeoutMillis: 1000,
        destroyTimeoutMillis: 1000,
        ...this.options.pool,
      },
      create: async () => {
        const dbc = await ibmdb.open(this.cn)
        return dbc
      },
      destroy: dbc => dbc.close(),
      validate: dbc => dbc.connected,
    }
  }
  // TODO: multi tenant related
  url4 (tenant) {
    return ''
  }
  // TODO: use this if dbc disconnects without knowing why
  ensureDBC () {
    return this.dbc || cds.error`Database connection is ${this._done || 'disconnected'}`
  }
  async set (variables) {
    // TODO: this sets temporal environment variables?
  }
  release () {
    return super.release()
  }
  prepare (sql) {
    // REVISIT: Make more efficient with Fetch or other functionalities from ibm_db
    // const stmt = this.dbc.prepare(sql)
    return {
      run: async () => {
        try {
          const result = await this.dbc.query(sql)
          return result
        } catch (error) {
          throw `${error}${sql}`
        }
      },
      get: async () => {
        try {
          const result = await this.dbc.query(sql)
          return result[0]
        } catch (error) {
          throw `${error}${sql}`
        }
      },
      all: async () => {
        try {
          return await this.dbc.query(sql)
        } catch (error) {
          throw `${error}${sql}`
        }
      },
      stream: async () => {
        // TODO
        try {
          return this.dbc.queryStream(sql)
        } catch (error) {
          throw `${error}${sql}`
        }
      },
    }
  }
  exec (sql) {
    return this.dbc.query(sql)
  }
  // static CQN2SQL = class CQN2DB2 extends SQLService.CQN2SQL {
  //   static Functions = require('./cql-functions')
  //   static ReservedWords = { ...super.ReservedWords, ...require('./ReservedWords.json') }
  //   //TODO: Types like UUID: () => `VARCHAR(36)`,
  //   static TypeMap = {
  //     ...super.TypeMap,
  //   }
  //   //TODO: InputConverters
  //   static InputConverters = {
  //     ...super.InputConverters,
  //   }
  //   static OutputConverters = {
  //     ...super.OutputConverters,
  //   }
  // }
  // async database ({ database }) {
  //   // TODO get correct creds

  //   try {
  //     const con = await this.factory.create()
  //     this.dbc = con
  //   } finally {
  //     if (this.dbc) {
  //       await this.dbc.close()
  //       delete this.dbc

  //       await this.disconnect()
  //     }
  //   }
  // }

  // async tenant ({ database, tenant }, clean = false) {
  //   //TODO
  // }
}

module.exports = DB2Service
