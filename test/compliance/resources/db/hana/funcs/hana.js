const hdb = require('hdb')

const creds = {
  rejectUnauthorized: false, // Turns of TLS validation on nodejs socket
  user: 'SYSTEM', // This is the default `SYSTEM` user on `HANA-cloud`
  password: 'Manager1', // This needs to be equal to the password defined in the docker run command
  host: 'localhost', // This needs to be the host of the docker machine
  port: '30041', // The default port
  useTLS: true,
  encrypt: true, // All HANA-cloud connections HAVE to be encrypted
  sslValidateCertificate: true, // The HANA-cloud docker image has self signed SSL certificates
  driver: 'com.sap.db.jdbc.Driver',
  url: 'jdbc:sap://localhost:30041?encrypt=true&validateCertificate=false',
  disableCloudRedirect: true,
}

let client

const connection = async function () {
  if (client) return client
  return new Promise((res, rej) => {
    const con = hdb.createClient() // hdb.createConnection();
    con.connect(creds, async err => {
      if (err) return rej(err)
      client = con
      res(client)
    })
  })
}

module.exports = async function (sql, values = []) {
  const con = await connection()

  return new Promise((res, rej) => {
    con.prepare(sql, (err, stmt) => {
      if (err) return rej(err)
      stmt.exec(values, (err, ret) => {
        if (err) return rej(err)
        res(ret)
      })
    })
  })
}
