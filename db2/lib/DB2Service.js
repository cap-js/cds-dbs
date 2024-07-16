const { SQLService } = require('@cap-js/db-service')
const ibmdb = require('ibm_db')
const cds = require('@sap/cds')
const crypto = require('crypto')
const { Writeable, Readable } = require('stream')
const DEBUG = cds.debug('sql|db')
/**
 *
 */
class DB2Service extends SQLService {
  init () {
    if (!this.options.indendentDeploy) {
      cds.options = cds.options || {}
      cds.options.dialect = 'plain'
    }
    this.kind = 'plain'
    this._queryCache = {}
    return super.init(...arguments)
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
        const cr = this.options.credentials || {}
        // TODO check may be SSL also to connect to db2?
        const credentials = {
          user: cds.env.requires.db.credentials.user,
          password: cds.env.requires.db.credentials.password,
          host: cds.env.requires.db.credentials.host,
          port: cds.env.requires.db.credentials.port,
          database: cds.env.requires.db.credentials.database,
        }
        const connStr = `DATABASE=${credentials.database};HOSTNAME=${credentials.host};UID=${credentials.user};PWD=${credentials.password};PORT=${credentials.port};PROTOCOL=TCPIP`
        // const dbc = await ibmdb.open(connStr)
        const dbc = await ibmdb.open(
          `DATABASE=testdb;HOSTNAME=localhost;UID=db2inst1;PWD=HariboMachtKinderFroh;PORT=50000;PROTOCOL=TCPIP`,
        )
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
