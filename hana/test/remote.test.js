process.env.CDS_SQL_NAMES = 'quoted'

const cds = require('../../test/cds')

/**
 * Documentation
 * https://help.sap.com/docs/HANA_SMART_DATA_INTEGRATION/7952ef28a6914997abc01745fef1b607/6ed502701abd4d1ca94d463d7dc6e99f.html
 */

describe('remote', () => {
  const { expect } = cds.test(__dirname + '/../../test/bookshop')

  beforeAll(async () => {
    const credentials = cds.db.options.credentials
    const sys = await cds.connect.to('db', { credentials: credentials.__system__ })
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
    <PropertyEntry name="supportformatquery" displayName="Support Format Query">true</PropertyEntry>
</ConnectionProperties>' 
WITH CREDENTIAL TYPE 'PASSWORD' USING 
'<CredentialEntry name="password">
    <user>alice</user>
    <password></password>
</CredentialEntry>'`)
        await tx.run(`CALL CHECK_REMOTE_SOURCE('${name}')`)
        await tx.run(`GRANT CREATE VIRTUAL TABLE ON REMOTE SOURCE "${name}" TO "${credentials.user}"`)
      }

      await ensureSSL()

      await ensureRemoteOData('Bookshop', 'http://bookshop:4008/admin')
      await ensureRemoteOData('Northwind', 'https://services.odata.org/V4/Northwind/Northwind.svc/')
    })

    await cds.connect.to('db', { credentials })
  })

  test('debugger', async () => {
    const entities = cds.entities('sap.capire.bookshop')

    const anno = {
      source: '@cds.remote.source',
      entity: '@cds.remote.entity',
    }

    for (const name in entities) {
      const entity = entities[name]
      if (entity[anno.source] && entity[anno.entity]) {
        // Remove original table
        await cds.run(cds.ql.DROP(entity))
        // Create virtual table
        await cds.run(`CREATE VIRTUAL TABLE "${entity.name}" AT "${entity[anno.source]}"."<NULL>"."<NULL>"."${entity[anno.entity]}"`)
      }
    }
    const {  Books, Authors, Products } = entities

    const books = await cds.ql`SELECT FROM ${Books} { *, author { * } } excluding { footnotes } limit 2`
    const authors = await cds.ql`SELECT FROM ${Authors} { *, books { * } excluding { footnotes } } limit 2`
    const products = await cds.ql`SELECT FROM ${Products} { *, Supplier { * } } limit 2`

    // expect(books).length(2)
    // expect(authors).length(2)
    expect(products).length(2)
  })
})
