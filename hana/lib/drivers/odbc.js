const path = require('path')
const { Readable, Stream } = require('stream')
const { text } = require('stream/consumers')

const odbc = require('odbc')

const { driver, prom, handleLevel } = require('./base')

const credentialMappings = [
  { old: 'certificate', new: 'ca' },
  { old: 'encrypt', new: 'useTLS' },
  { old: 'sslValidateCertificate', new: 'rejectUnauthorized' },
  { old: 'validate_certificate', new: 'rejectUnauthorized' },
]

class HDBDriver extends driver {
  /**
   * Instantiates the HDBDriver class
   * @param {import('./base').Credentials} creds The credentials for the HDBDriver instance
   */
  constructor(creds) {
    creds = {
      fetchSize: 1 << 16, // V8 default memory page size
      ...creds,
    }

    // Retain hana credential mappings to hdb / node credential mapping
    for (const m of credentialMappings) {
      if (m.old in creds && !(m.new in creds)) creds[m.new] = creds[m.old]
    }

    creds.connectionString = [
      // src: https://community.sap.com/t5/technology-blogs-by-sap/using-the-odbc-driver-for-abap-on-linux/ba-p/13513705
      `driver=${path.resolve(__dirname, 'bin/libodbcHDB.so')}`,
      'client=100', // TODO: see what this means
      'trustall=true', // supersecure
      `cryptolibrary=${path.resolve(__dirname, 'bin/libsapcrypto.so')}`,
      `encrypt=${creds.encrypt}`,
      `sslValidateCertificate=${creds.sslValidateCertificate}`,
      `disableCloudRedirect=true`,

      `servernode=${creds.host}:${creds.port}`,
      `database=${creds.schema}`,
      `uid=${creds.user}`,
      `pwd=${creds.password}`,

      'uidtype=alias',
      'typemap=semantic', // semantic or native or ...
    ].join(';')

    super(creds)
    this.connected = odbc.connect(creds)
    this.connected.then(dbc => this._native = dbc)
    this.connected.catch(() => this.destroy?.())
  }

  set(variables) {
    // TODO:
  }

  async validate() {
    // TODO:
    return true
  }

  /**
   * Connects the driver using the provided credentials
   * @returns {Promise<any>}
   */
  async connect() {
    return this.connected.then(async () => {
      const [version] = await Promise.all([
        this._native.query('SELECT VERSION FROM "SYS"."M_DATABASE"'),
        this._creds.schema && this._native.query(`SET SCHEMA ${this._creds.schema}`),
      ])
      const split = version[0].VERSION.split('.')
      this.server = {
        major: split[0],
        minor: split[2],
        patch: split[3],
      }
    })
  }

  async disconnect() {
    return this._native.close()
  }

  // TODO: find out how to do this with odbc driver
  async begin() {
    return this._native.beginTransaction()
  }
  async commit() {
    return this._native.commit()
  }
  async rollback() {
    return this._native.rollback()
  }

  async exec(sql) {
    await this.connected
    return this._native.query(sql)
  }

  async prepare(sql, hasBlobs) {
    try {
      const stmt = await this._native.createStatement()
      await stmt.prepare(sql)
      const run = async (args) => {
        try {
          await stmt.bind(await this._extractStreams(args).values)
          return await stmt.execute()
        } catch (e) {
          throw e.odbcErrors[0]
        }
      }
      return {
        run,
        get: (..._) => run(..._).then(r => r[0]),
        all: run,
        proc: async (data, outParameters) => {
          // this._native.callProcedure(null,null,)
          const rows = await run(data)
          return rows // TODO: see what this driver returns for procedures
        },

        stream: (..._) => stmt.bind(..._).then(async () => Readable.from(this._iterator(await stmt.execute({ cursor: true })))),
      }
    } catch (e) {
      e.message += ' in:\n' + (e.query = sql)
      throw e
    }
  }

  _extractStreams(values) {
    // Removes all streams from the values and replaces them with a placeholder
    if (!Array.isArray(values)) return { values: [], streams: [] }
    const streams = []
    values = values.map((v, i) => {
      if (v instanceof Stream) {
        return text(v)
      }
      return v
    })
    return {
      values: Promise.all(values),
      streams,
    }
  }

  // TODO: implement proper raw stream
  async *_iterator(cursor) {
    while (!cursor.noData) {
      for (const row of await cursor.fetch()) {
        yield row
      }
    }
    await cursor.close()
  }
}

module.exports.driver = HDBDriver
