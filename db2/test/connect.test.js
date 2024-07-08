const expect = require('chai').expect
const cds = require('@sap/cds')
const ibmdb = require('ibm_db')

describe.skip('DB2', function () {
  it('connect', async function () {
    cds.env.requires.db = require('./service.json')
    let conn = await ibmdb
      .open(`DATABASE=testdb;HOSTNAME=localhost;UID=db2inst1;PWD=HariboMachtKinderFroh;PORT=50000;PROTOCOL=TCPIP`)
      .catch(e => {
        console.log(e)
      })
    await conn.query('drop table mytab').catch(e => {
      console.log(e)
    })
    await conn.query('create table mytab(c1 int, c2 varchar(10))')
    const test = await conn.connected
    console.log('🚀 ~ const:', test)
  })
})
