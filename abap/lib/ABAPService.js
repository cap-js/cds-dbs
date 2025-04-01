const { SQLService } = require('@cap-js/db-service')
const cds = require('@sap/cds')
const { Readable } = require('stream')
const odbc = require('odbc')
const path = require('path');

class ABAPService extends SQLService {
  init() {
    return super.init(...arguments)
  }

  get factory() {
    return {
      options: { ...this.options.pool },
      create: async (/*tenant*/) => {
        let credentials = this.options.credentials
        if(!credentials.connectionString) 
          credentials.connectionString = this.getConnectionString(credentials)
        const dbc = await odbc.connect(credentials)
        dbc.schema = credentials.schema

        return dbc
      },
      destroy: dbc => dbc.close(),
      validate: dbc => dbc.open,
    }
  }

  getConnectionString(credentials) {
    return [
      `driver=${path.resolve(__dirname, '../bin/ODBC_driver_for_ABAP.so')}`,
      'client=100',
      'trustall=true',
      `CryptoLibrary=${path.resolve(__dirname, '../bin/libsapcrypto.so')}`,
      `host=${credentials.ABAP_HOST || 'localhost'}`,
      `port=${credentials.ABAP_PORT || '443'}`,
      `servicePath=${credentials.ABAP_PATH || '/sap/bc/sql/sql1/sap/s_privileged'}`,
      `uid=${credentials.ABAP_USER || 'SYSTEM'}`,
      `pwd=${credentials.ABAP_PASSWORD || 'Manager1'}`,
      `language=EN`,
      'uidType=alias',
      'typeMap=semantic',
    ].join(';');
  }
  

  url4(/*tenant*/) {
    let { connectionString } = this.options.credentials || this.options || {}
    return connectionString
  }

  set(variables) {
    // REVISIT:
    // Does ABAP support enviroment variables
    // language is in the connection options
  }

  async prepare(sql) {
    try {
      const stmt = await this.dbc.createStatement()
      await stmt.prepare(sql)
      console.log('SQL:', sql)
      const run = (..._) => stmt.bind(..._).then(() => stmt.execute())
      return {
        run,
        get: (..._) => run(..._).then(r => r[0]),
        all: run,
        stream: (..._) => stmt.bind(..._).then(async () => Readable.from(this._iterator(await stmt.execute({ cursor: true })))),
      }
    } catch (e) {
      e.message += ' in:\n' + (e.query = sql)
      throw e
    }
  }

  async *_iterator(cursor) {
    while (!cursor.noData) {
      for (const row of await cursor.fetch()) {
        yield row
      }
    }
    await cursor.close()
  }

  exec(sql) {
    return this.dbc.query(sql)
  }

  static CQN2SQL = class CQN2AbapSql extends SQLService.CQN2SQL {

    static OutputConverters = {
      ...super.OutputConverters,
      // TODO: add output converters where required
    }

    // Used for SQL function expressions
    static Functions = { ...super.Functions, ...require('./cql-functions') }

    static ReservedWords = {
      ...super.ReservedWords
      // TODO: define reserved words
    }

    // ABAP SQL doesn't seem to like quotes especially escaped quotes
    quote(name) {
      return name
    }

    // All entity names require a schema prefix
    name(name) {
      // REVISIT: how to best access the schema name
      const schema = this.context?.tx.dbc?.schema || cds.services.abap.options.credentials.schema;
      return `${schema}.${name.replace(/abap./, '')}`
    }

    // All aliases must be strings
    // this is not the case for the `exists (SELECT 1 as 1 …)` subqueries
    column_alias4(x) {
      const as = x.as || x.func || x.val;
      return as && typeof as !== 'string' ? `"${as}"` : as;
    }
    

  }

  // As no write operations are supported BEGIN, COMMIT and ROLLBACK are not required
  async onEVENT() { }

  async onINSERT() {
    throw cds.error`INSERT queries not supported`
  }

  async onUPDATE(req) {
    throw cds.error`UPSERT queries not supported`

  }
}

module.exports = ABAPService
