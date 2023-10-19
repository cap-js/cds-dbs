const { resolve } = require('path')
const cds = require('../../test/cds.js')
if (cds.env.fiori) cds.env.fiori.lean_draft = true
else cds.env.features.lean_draft = true

const project = resolve(__dirname, 'beershop')
const { GET, POST, expect, data } = cds.test('serve', '--project', project).verbose()

process.env.DEBUG && jest.setTimeout(100000)

describe('OData to Postgres dialect', () => {
  data.autoIsolation(true)
  data.autoReset(true)

  describe('OData types: CREATE', () => {
    test(' -> Boolean', async () => {
      const response = await POST('/beershop/TypeChecks', {
        type_Boolean: true,
      })
      expect(response.status).to.equal(201)
    })

    test(' -> Int32', async () => {
      const response = await POST('/beershop/TypeChecks', {
        type_Int32: 10,
      })
      expect(response.status).to.equal(201)
    })

    test(' -> Int64', async () => {
      const response = await POST('/beershop/TypeChecks', {
        type_Int64: 1000000000000,
      })
      expect(response.status).to.equal(201)
    })

    test(' -> Decimal', async () => {
      const response = await POST(
        '/beershop/TypeChecks',
        {
          type_Decimal: '3.1',
        },
        {
          headers: {
            'content-type': 'application/json;charset=UTF-8;IEEE754Compatible=true',
          },
        },
      )
      expect(response.status).to.equal(201)
    })

    test(' -> Double', async () => {
      const response = await POST('/beershop/TypeChecks', {
        type_Double: 23423.1234234,
      })
      expect(response.status).to.equal(201)
    })

    test(' -> Date', async () => {
      const response = await POST('/beershop/TypeChecks', {
        type_Date: '2015-12-31',
      })
      expect(response.status).to.equal(201)
    })

    test(' -> Time', async () => {
      const response = await POST('/beershop/TypeChecks', {
        type_Time: '10:21:15',
      })
      expect(response.status).to.equal(201)
    })

    test(' -> DateTime', async () => {
      const response = await POST('/beershop/TypeChecks', {
        type_DateTime: '2012-12-03T07:16:23.574Z',
      })
      expect(response.status).to.equal(201)
    })

    test(' -> Timestamp', async () => {
      const value = '2012-12-03T07:16:23.574Z'
      const response = await POST('/beershop/TypeChecks', {
        type_Timestamp: value,
      })
      expect(response.status).to.equal(201)
      const verify = await GET(`/beershop/TypeChecks(${response.data.ID})`)
      expect(verify.data.type_Timestamp).to.equal(value)
    })

    test(' -> String', async () => {
      const response = await POST('/beershop/TypeChecks', {
        type_String: 'Hello World',
      })
      expect(response.status).to.equal(201)
    })

    test(' -> Binary', async () => {
      const response = await POST('/beershop/TypeChecks', {
        type_Binary: 'SGVsbG8gV29ybGQ=',
      })
      expect(response.status).to.equal(201)
    })

    test(' -> LargeBinary', async () => {
      const response = await POST('/beershop/TypeChecks', {
        type_LargeBinary: 'SGVsbG8gV29ybGQ=',
      })
      expect(response.status).to.equal(201)
    })

    test(' -> LargeString', async () => {
      const response = await POST('/beershop/TypeChecks', {
        type_LargeString:
          'Magna sit do quis culpa elit laborum culpa laboris excepteur. Proident qui culpa mollit ut ad enim. Reprehenderit aute occaecat ut ut est nostrud aliquip.',
      })
      expect(response.status).to.equal(201)
    })
  })
})
