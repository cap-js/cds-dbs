const path = require('path')

module.exports = {
  "impl": "@cap-js/abap",
  "credentials": {
    "schema": process.env.ABAP_SCHEMA || 'SYS',
    "connectionString": [
      `driver=${path.resolve(__dirname, '../bin/ODBC_driver_for_ABAP.so')}`,
      'client=100',
      'trustall=true',
      `CryptoLibrary=${path.resolve(__dirname, '../bin/libsapcrypto.so')}`,

      `host=${process.env.ABAP_HOST || 'localhost'}`,
      `port=${process.env.ABAP_PORT || '443'}`,
      `servicePath=${process.env.ABAP_PATH || '/sap/bc/sql/sql1/sap/s_privileged'}`,
      `uid=${process.env.ABAP_USER || 'SYSTEM'}`,
      `pwd=${process.env.ABAP_PASSWORD || 'Manager1'}`,

      `language=${process.env.ABAP_LANG || 'EN'}`,
      'uidType=alias',
      'typeMap=semantic', // or native
    ].join(';')
  }
}