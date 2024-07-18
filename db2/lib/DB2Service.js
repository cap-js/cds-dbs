const { SQLService } = require('@cap-js/db-service')
const ibmdb = require('ibm_db')
const cds = require('@sap/cds')
const crypto = require('crypto')
const { Writeable, Readable } = require('stream')
const DEBUG = cds.debug('sql|db')
const LOG = cds.log('db2|db')
const ISO_8601_FULL = /\'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(([+-]\d\d:\d\d)|Z)?/i
const execute = require('./execute')
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
    this.options.schema = 'FOERDERLOTSE'
    this.cn = getCredentialsForClient(this.options.credentials, true)
    // this.on('READ', '*', req => {
    //   LOG.info(req.event)
    // })
    // this.on('CREATE', '*', req => {
    //   LOG.info(req.event)
    // })
    // this.on('UPDATE', '*', req => {
    //   LOG.info(req.event)
    // })
    // this.on('DELETE', '*', req => {
    //   LOG.info(req.event)
    // })
    this.on(['BEGIN', 'COMMIT', 'ROLLBACK'], req => {
      LOG.info(req.event)
    })
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
        const options = {
          codeSet: '1252',
        }
        const dbc = await ibmdb.open(this.cn, options)
        return dbc
      },
      destroy: dbc => dbc.close(),
      validate: dbc => dbc.connected,
    }
  }
  /**
   * Convert the cds compile -to sql output to a DB2 compatible format
   * @see https://www.ibm.com/docs/vi/db2-for-zos/12?topic=columns-data-types
   *
   * NVARCHAR -> VARCHAR
   * DOUBLE -> -
   * BINARY_BLOB -> BLOB
   * BLOB -> -
   * NCLOB -> CLOB
   * TIMESTAMP_TEXT -> TIMESTAMP
   * TIME_TEXT -> TIME
   * DATE_TEXT -> DATE
   *
   * @param {String} SQL from cds compile -to sql
   * @returns {String} db2 sql compatible SQL
   */
  cdssql2db2sql (cdssql) {
    let db2sql = cdssql.replace(/NVARCHAR/g, 'VARCHAR')
    db2sql = db2sql.replace(/BINARY_BLOB/g, 'BLOB')
    db2sql = db2sql.replace(/NCLOB/g, 'CLOB(100M)')
    db2sql = db2sql.replace(/TIMESTAMP_TEXT/g, 'TIMESTAMP')
    db2sql = db2sql.replace(/TIME_TEXT/g, 'TIME')
    db2sql = db2sql.replace(/DATE_TEXT/g, 'DATE')

    db2sql = db2sql.replace(`strftime('%Y-%m-%dT%H:%M:%S.001Z', 'now')`, 'CURRENT_TIMESTAMP')
    db2sql = db2sql.replace(`strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')`, 'CURRENT_TIMESTAMP')

    let index = db2sql.search(ISO_8601_FULL)
    while (index > -1) {
      if (index > -1) {
        db2sql = db2sql.replace(ISO_8601_FULL, function (date) {
          return date.replace('T', ' ').replace('Z', '')
        })
      }
      index = db2sql.search(ISO_8601_FULL)
    }

    return db2sql
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
    // TODO: this sets temporal environment variables? 41) .setAttr(attributeName, value, callback)
  }
  release () {
    return super.release()
  }
  async prepare (sql) {
    // REVISIT: Make more efficient with Fetch or other functionalities from ibm_db
    // const stmt = this.dbc.prepare(sql)
    const transformedSql = this.sql2db2sql(sql)
    return {
      run: async () => {
        try {
          const result = await this.dbc.query(transformedSql)
          return result
        } catch (error) {
          throw `${error}sql:${sql}transformedSql:${transformedSql}`
        }
      },
      get: async () => {
        try {
          const result = await this.dbc.query(transformedSql)
          return result[0]
        } catch (error) {
          throw `${error}sql:${sql}transformedSql:${transformedSql}`
        }
      },
      all: async () => {
        try {
          return await this.dbc.query(transformedSql)
        } catch (error) {
          throw `${error}sql:${sql}transformedSql:${transformedSql}`
        }
      },
      stream: async () => {
        // TODO
        try {
          return this.dbc.queryStream(transformedSql)
        } catch (error) {
          throw `${error}sql:${sql}transformedSql:${transformedSql}`
        }
      },
    }
  }
  /**
   *
   * @param {string} sql
   * @returns
   */
  sql2db2sql (sql) {
    // DROP VIEW IF EXISTS
    const DROPVIEWIFEXISTS = sql.match(/^DROP VIEW IF EXISTS (\w+);$/)
    if (DROPVIEWIFEXISTS) {
      return `BEGIN DECLARE CONTINUE HANDLER FOR SQLSTATE '42704' BEGIN END; EXECUTE IMMEDIATE 'DROP VIEW ${DROPVIEWIFEXISTS[1]}'; END;`
    }
    return sql
  }
  async exec (sql) {
    try {
      const response = await this.dbc.query(sql)
      return response
    } catch (error) {
      LOG.info(error)
    }
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
