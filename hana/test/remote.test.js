process.env.CDS_SQL_NAMES = 'quoted'

const cds = require('../../test/cds')

/**
 * Documentation
 * https://help.sap.com/docs/HANA_SMART_DATA_INTEGRATION/7952ef28a6914997abc01745fef1b607/6ed502701abd4d1ca94d463d7dc6e99f.html
 */

describe('remote', () => {
  let hasReplicaSupport = true
  afterAll(async () => {
    // this afterAll has to be defined before cds.test as otherwise the afterAll inside cds.test fails
    // If the real time replica is not dropped it is not longer possible to drop the test tenant
    if (hasReplicaSupport) await cds.run(`ALTER VIRTUAL TABLE "sap.capire.bookshop.Target" DROP REPLICA`)
  })

  const { expect } = cds.test(__dirname + '/../../test/bookshop')

  beforeAll(async () => {
    cds.requires.system = { ...cds.requires.db }
    const credentials = cds.db.options.credentials

    const sys = await cds.connect.to('system')
    await sys.tx(async tx => {
      await tx.run(`CREATE ADAPTER "ODataAdapter" PROPERTIES 'display_name=OData Adapter;description=OData Adapter' AT LOCATION DPSERVER;`).catch(() => { })

      const ensureSSL = async function () {
        // Add certificates, because everything is more fun with certificates
        const sapStore = await tx.run(`CREATE PSE ODATA`).catch(err => err)

        const odataOrgCert = await tx.run(`
CREATE CERTIFICATE ODATA_ORG FROM '-----BEGIN CERTIFICATE-----
MIIIZzCCBk+gAwIBAgITMwGHwz45zQ3UA0ZwxQAAAYfDPjANBgkqhkiG9w0BAQwF
ADBdMQswCQYDVQQGEwJVUzEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9u
MS4wLAYDVQQDEyVNaWNyb3NvZnQgQXp1cmUgUlNBIFRMUyBJc3N1aW5nIENBIDAz
MB4XDTI1MDEyMjA2MTUyNFoXDTI1MDcyMTA2MTUyNFowYjELMAkGA1UEBhMCVVMx
CzAJBgNVBAgTAldBMRAwDgYDVQQHEwdSZWRtb25kMR4wHAYDVQQKExVNaWNyb3Nv
ZnQgQ29ycG9yYXRpb24xFDASBgNVBAMMCyoub2RhdGEub3JnMIIBIjANBgkqhkiG
9w0BAQEFAAOCAQ8AMIIBCgKCAQEAm1nZbj/xfC5usF35sDmuCp5xH83vmbfcSMRc
jR47fy+rWNgZ/CUOlhHBrpYOQVOpprR7QG05bBZIA16qdBoqRuBTbNIqxvlTXDj/
OExFrG4S9vBJkaQys7IOq+2vPp+boTwyFFg0UfQKw+CV56YOz/cPnSlsnT2ZQ3fI
M8Z90oN87ks3CfdLMawaNAkn0AthVk6bJmDsyP5LwxxaOApyTptng17kH0Hy5Sz9
vaAZ2sASTC3cQjtCwQkY7BgGEc3e3FBW+uNgubH7T6jmGI/zn+rXrKHdcqss+i0T
bz5cE1PRbZytInqNKlTIhcgpa16tDPwyw1Hr22ilLRFj5clbFQIDAQABo4IEGTCC
BBUwggF/BgorBgEEAdZ5AgQCBIIBbwSCAWsBaQB3AN3cyjSV1+EWBeeVMvrHn/g9
HFDf2wA6FBJ2Ciysu8gqAAABlIyv7RMAAAQDAEgwRgIhAMU4pnQLlaNsxsn/n2g8
SbTPv/nAK6l3smGh7wsU4a2+AiEA1wTm/cBmNdgNvFbGjWGmzA4S3HqsFf1rct6F
hjIjYzQAdwB9WR4S4XgqexxhZ3xe/fjQh1wUoE6VnrkDL9kOjC55uAAAAZSMr+zL
AAAEAwBIMEYCIQDi+5xe44NzMfKZSyjTw80RshmC2v7V+D0wbxulqT4EkQIhAOxl
B6oPmbLJK7yDt8FyXU3QW00J3HOqGXNMuCsGBGwJAHUAGgT/SdBUHUCv9qDDv/HY
xGcvTuzuI0BomGsXQC7ciX0AAAGUjK/tPAAABAMARjBEAiArbI6bD/PRzWCeIWU9
I5ReOhlHh1MgO0ApV5KJSeI5aQIgfrHOkX484Ovrdl0ImIXyMZrX/b7k74Xfw5IY
xBuN8tcwJwYJKwYBBAGCNxUKBBowGDAKBggrBgEFBQcDAjAKBggrBgEFBQcDATA8
BgkrBgEEAYI3FQcELzAtBiUrBgEEAYI3FQiHvdcbgefrRoKBnS6O0AyH8NodXYKr
5zCH7fEfAgFkAgEtMIG0BggrBgEFBQcBAQSBpzCBpDBzBggrBgEFBQcwAoZnaHR0
cDovL3d3dy5taWNyb3NvZnQuY29tL3BraW9wcy9jZXJ0cy9NaWNyb3NvZnQlMjBB
enVyZSUyMFJTQSUyMFRMUyUyMElzc3VpbmclMjBDQSUyMDAzJTIwLSUyMHhzaWdu
LmNydDAtBggrBgEFBQcwAYYhaHR0cDovL29uZW9jc3AubWljcm9zb2Z0LmNvbS9v
Y3NwMB0GA1UdDgQWBBRS2kPY2jH7CRW3l8keZdnNYOfLbDAOBgNVHQ8BAf8EBAMC
BaAwIQYDVR0RBBowGIIJb2RhdGEub3JnggsqLm9kYXRhLm9yZzAMBgNVHRMBAf8E
AjAAMGoGA1UdHwRjMGEwX6BdoFuGWWh0dHA6Ly93d3cubWljcm9zb2Z0LmNvbS9w
a2lvcHMvY3JsL01pY3Jvc29mdCUyMEF6dXJlJTIwUlNBJTIwVExTJTIwSXNzdWlu
ZyUyMENBJTIwMDMuY3JsMGYGA1UdIARfMF0wUQYMKwYBBAGCN0yDfQEBMEEwPwYI
KwYBBQUHAgEWM2h0dHA6Ly93d3cubWljcm9zb2Z0LmNvbS9wa2lvcHMvRG9jcy9S
ZXBvc2l0b3J5Lmh0bTAIBgZngQwBAgIwHwYDVR0jBBgwFoAU/glxQFUFEETYpIF1
uJ4a6UoGiMgwHQYDVR0lBBYwFAYIKwYBBQUHAwIGCCsGAQUFBwMBMA0GCSqGSIb3
DQEBDAUAA4ICAQAj35dDJxOx6096oFdLG+Vzt4cN+Db8zla2iY0V+iijzyRFEmUm
jJY6Lmi3GfUgHYKm9j3luoQp1MjUHY+H0MK/2PCV6ZzDAYxeaOkKEaHLwKagkOhM
Cke84iaMPp+6TyfStPEBpcFPAtG21sv5WoYLSHD2rSISkyUSDpii6hr87tI4h2fD
VQsE41PYnT2wDkro0uS2ijENP3ig3Dk5hOXdqDcfOd0JsseX9HMEBsLzDc/ZCzBi
H7+hXmJqPsXSDfOXhjC7/vjivvHp3zrAbhnfZZEXfbxzC6iidNw3CpdU5+8YisvP
wPMC2u7GTB2yg7Y9CBzg8Nx2EmSShkbMfskVGNKM0O5prMkq2B9SL/y38P7gpuXr
1uKC9pLPE7+egQvXMVa1CJ8ugpbD7ITE3JMKvWRrdMYGvghJYz0E/B/SvbcAhFyq
RI07EoQiDva8ti9S5tMm50xbhaGcDgzcGsJOVIaXBlIU2yRHWSfaypsoUAhXsnRx
qWelbi4T5He1daZXyi6/x4Y6MnBFSK57nH21ZoPs349wYE7Ko5Ve8NkMERQVtSqo
D8Rx6ZwRGg+vbudZ44uBQOGzy44o0s+w8WicUXL/+8+U2hQb3keEOLMuWb/vK9y7
D4oWCFEn2r6Z9arcpYkn53pYkThyIjI6Rs2ELgP/p2rqwhw3MQz7JIQIcQ==
-----END CERTIFICATE-----
'`).catch(err => err)

        const addOrgCert = await tx.run(`ALTER PSE ODATA ADD CERTIFICATE ODATA_ORG;`).catch(err => err)
        const setPurposeOData = await tx.run(`SET PSE ODATA PURPOSE REMOTE SOURCE;`).catch(err => err)
      }

      const ensureRemoteOData = async function (name, url) {
        await tx.run(`DROP REMOTE SOURCE "${name}" CASCADE`).catch(() => { })
        await tx.run(`CREATE REMOTE SOURCE "${name}" ADAPTER "ODataAdapter" AT LOCATION DPSERVER CONFIGURATION
'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ConnectionProperties name="connection_properties">
    <PropertyEntry name="URL" displayName="URL">${url}</PropertyEntry>
    <PropertyEntry name="supportformatquery" displayName="Support Format Query">false</PropertyEntry>
</ConnectionProperties>' 
WITH CREDENTIAL TYPE 'PASSWORD' USING 
'<CredentialEntry name="password">
    <user>alice</user>
    <password></password>
</CredentialEntry>'`)
        await tx.run(`CALL CHECK_REMOTE_SOURCE('${name}')`)
        await tx.run(`GRANT CREATE VIRTUAL TABLE ON REMOTE SOURCE "${name}" TO "${credentials.user}"`)
        await tx.run(`GRANT CREATE REMOTE SUBSCRIPTION ON REMOTE SOURCE "${name}" TO "${credentials.user}"`)
        remotes[name] = true
      }

      const ensureRemoteHANA = async function (name, creds) {
        await tx.run(`DROP REMOTE SOURCE "${name}" CASCADE`).catch((err) => { debugger })
        await tx.run(`CREATE REMOTE SOURCE "${name}" ADAPTER "hanaodbc" 
CONFIGURATION 'Driver=libodbcHDB.so;ServerNode=${creds.host}:${creds.port};trustall=TRUE;encrypt=TRUE;sslValidateCertificate=FALSE'
WITH CREDENTIAL TYPE 'PASSWORD' USING 'user=${creds.user};password=${creds.password}'`)
        await tx.run(`CALL CHECK_REMOTE_SOURCE('${name}')`)
        await tx.run(`GRANT CREATE VIRTUAL TABLE ON REMOTE SOURCE "${name}" TO "${credentials.user}"`)
        await tx.run(`GRANT CREATE REMOTE SUBSCRIPTION ON REMOTE SOURCE "${name}" TO "${credentials.user}"`)
        remotes[name] = true
      }

      await ensureSSL()

      await ensureRemoteOData('Bookshop', 'http://bookshop:4008/admin').catch(() => { })
      await ensureRemoteOData('Northwind', 'https://services.odata.org/V4/Northwind/Northwind.svc/')

      await ensureRemoteHANA('Self', credentials)
        // HXE uses a different internal port then exposed in docker
        .catch(() => ensureRemoteHANA('Self', { ...credentials, port: 39041 }))

        // HXE doesn't have the RTR version of virtual table replicas
        ;[{ hasReplicaSupport }] = await tx.run(`SELECT COUNT(*) as "hasReplicaSupport" FROM SYS.M_FEATURES WHERE COMPONENT_NAME='TABLE REPLICATION' AND FEATURE_NAME='REMOTE ASYNCHRONOUS REPLICA'`)

      // Create a remote table that can be used as target (called TARGET)
      await tx.run(`DROP TABLE "TARGET"`).catch(() => { })
      await tx.run(`CREATE TABLE "TARGET" (ID INTEGER NOT NULL, KEY NVARCHAR(255), VALUE NVARCHAR(255), PRIMARY KEY (ID))`)
      await tx.run(`INSERT INTO "TARGET" (ID, KEY, VALUE) VALUES (?,?,?)`, [
        [1, 'property', 'value'],
        [2, 'pointer', 'memory'],
      ])
      await tx.run(`GRANT ALL PRIVILEGES ON "TARGET" TO "${credentials.user}"`)
      // const entities = await tx.dbc._native.execute(`CALL SYS.GET_REMOTE_SOURCE_OBJECT_TREE('Self','<NULL>SYSTEM',?,?)`)
      // debugger
    })
  })

  // Track successfully created remotes to only attempt to create virtual tables where the remote exists
  const remotes = {}

  test('debugger', async () => {
    const entities = cds.entities('sap.capire.bookshop')

    const anno = {
      source: '@cds.remote.source',
      database: '@cds.remote.database',
      schema: '@cds.remote.schema',
      entity: '@cds.remote.entity',
      replicated: '@cds.remote.replicated',
    }

    for (const name in entities) {
      const entity = entities[name]
      if (entity[anno.source] && entity[anno.entity] && remotes[entity[anno.source]]) {
        // Remove original table
        await cds.run(cds.ql.DROP(entity))
        // Create virtual table
        await cds.run(`CREATE VIRTUAL TABLE "${entity.name}" AT "${entity[anno.source]}"."${entity[anno.database] || '<NULL>'}"."${entity[anno.schema] || '<NULL>'}"."${entity[anno.entity]}"`)
        if (entity[anno.replicated] && hasReplicaSupport) await cds.run(`ALTER VIRTUAL TABLE "${entity.name}" ADD SHARED REPLICA`)
      }
    }
    let { Books, Products, Target } = entities

    const products = await cds.ql`SELECT FROM ${Products} { *, Supplier { * } } limit 2`
    expect(products).length(2)

    const targetBefore = await cds.ql`SELECT FROM ${Target} { * }`

    // Insert entries into the remote table TARGET
    const sys = await cds.connect.to('system')
    await sys.run(`INSERT INTO "TARGET" (ID, KEY, VALUE) VALUES (?,?,?)`, [
      [3, 'prop', 'val'],
      [4, 'p', 'm'],
    ])

    // Poll local replica for new entries
    const s = performance.now()
    let targetAfter = []
    let counter = 0
    while (targetAfter.length <= targetBefore.length) {
      targetAfter = await cds.ql`SELECT FROM ${Target} { * }`
      counter++
    }
    const dur = performance.now() - s

    console.log('target updated after:', dur >>> 0, 'ms (read:', counter, 'times)')

    await cds.ql.DELETE(Books) // DELETE works, but with a where clause it doesn't actually send the DELETE requests
    await cds.ql.INSERT([{ ID: 999 }]).into(Books)
    const booksAfter = await cds.ql`SELECT FROM ${Books} { * } excluding { footnotes } where ID = 999`
    expect(booksAfter).length(1)
  })
})
