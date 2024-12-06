const path = require('path')

module.exports = {
  "impl": "@cap-js/abap",
  "credentials": {
    "schema": "/ITAPC1/SQL_FLIGHTS_1",
    "connectionString": [
      // src: https://community.sap.com/t5/technology-blogs-by-sap/using-the-odbc-driver-for-abap-on-linux/ba-p/13513705
      `driver=${path.resolve(__dirname, '../bin/ODBC_driver_for_ABAP.so')}`,
      'client=100', // TODO: see what this means
      'trustall=true', // supersecure
      `CryptoLibrary=${path.resolve(__dirname, '../bin/libsapcrypto.so')}`,

      // src: https://github.tools.sap/cap/dev/issues/1163
      'host=25638c75-a54b-4658-8b04-3a1156f2c4f5.abap.eu10.hana.ondemand.com',
      'port=443',
      'servicePath=/sap/bc/sql/sql1/sap/s_privileged',
      'Uid=ITAPC1_SQL_CAP_TESTS',
      'Pwd=du2wPBiDdYbRbvvyGliPedKLvNHuWX_hzAvVNEH',

      // src: https://github.wdf.sap.corp/orca/data_mart_management_service/blob/bf1ca50de56079cf3959f7f849f6a314b1cf7542/service/connections/models/SAPS4HanaCloud.ts#L668
      'language=EN',
      'uidType=alias',
      'typeMap=semantic', // or native
    ].join(';')
  }
}