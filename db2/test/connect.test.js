const expect = require('chai').expect
const cds = require('@sap/cds')
const ibmdb = require('ibm_db')
const ConnStr = ``

describe('DB2', function () {
  describe('connect', async function () {
    cds.env.requires.db = require('./service.json')
    console.log('before connecting')
    let conn = await ibmdb.open(
      `DATABASE=testdb;HOSTNAME=localhost;UID=db2inst1;PWD=HariboMachtKinderFroh;PORT=50000;PROTOCOL=TCPIP`,
    )
    await conn.query('drop table mytab').catch(e => {
      console.log(e)
    })
    await conn.query('create table mytab(c1 int, c2 varchar(10))')
    console.log('🚀 ~ conn:', conn)
  })
})
