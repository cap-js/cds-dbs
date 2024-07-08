const ibmdb = require('ibm_db')
const cds = require('@sap/cds')
const DB2Service = require('./lib/DB2Service')

const db2Instance = new DB2Service()
// TODO: prepare a statement
const preparedStatement = db2Instance.prepare('SELECT * FROM TEST')
debugger
