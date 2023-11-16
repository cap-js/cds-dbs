const cds = require('../../../test/cds.js')

describe('temporal', () => {
  const { GET, POST } = cds.test(__dirname, 'model.cds')

  beforeAll(async () => {
    const db = await cds.connect.to('db')
    const { fooTemporal } = db.model.entities('test')
    await db.create(fooTemporal).entries([
      { ID: 1, validFrom: '1990-01-01T00:00:00.000Z', validTo: '9999-12-31T23:59:59.999Z' },
      { ID: 2, validFrom: '2000-01-01T00:00:00.000Z', validTo: '9999-12-31T23:59:59.999Z' }
    ])
  })

  test('READ', async () => {
    let validAt, res

    validAt = '1970-01-01T00:00:00.000Z'
    res = await GET(`/test/fooTemporal?sap-valid-at=${validAt}`)
    expect(res.data.value.length).toBe(0)

    validAt = '1995-01-01T00:00:00.000Z'
    res = await GET(`/test/fooTemporal?sap-valid-at=${validAt}`)
    expect(res.data.value.length).toBe(1)
    const it = res.data.value[0]
    expect(it).toMatchObject({ ID: 1 })
    // managed and temporal shall not clash
    expect(it.createdAt).not.toEqual(it.validFrom)

    validAt = '2010-01-01T00:00:00.000Z'
    res = await GET(`/test/fooTemporal?sap-valid-at=${validAt}`)
    expect(res.data.value.length).toBe(2)
  })

  test('UPSERT', async () => {
    const validFrom = '2000-01-01T00:00:00.000Z'
    const url = `/test/fooTemporal?sap-valid-from=${validFrom}`
    const data = { ID: 42, validFrom }
    const res = await POST(url, data)
    expect(res.data).toMatchObject({ validFrom })
  })
})
