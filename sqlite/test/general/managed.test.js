const cds = require('../../../test/cds.js')

const { POST, PUT } = cds.test(__dirname, 'model.cds')

describe('Managed thingies', () => {
  test('INSERT execute on db only', async () => {
    const db = await cds.connect.to('db')
    return db.tx(async () => {
      // REVISIT: Why do we allow overriding managed elements here?
      await INSERT.into('test.foo').entries({ ID: 2, modifiedBy: 'samuel' })

      const result = await SELECT.from('test.foo').where({ ID: 2 })
      expect(result).toEqual([
        {
          ID: 2,
          createdAt: expect.any(String),
          createdBy: 'anonymous',
          modifiedAt: expect.any(String),
          modifiedBy: 'samuel',
        },
      ])
    })
  })

  test('UPSERT execute on db only', async () => {
    // UPSERT behaves like UPDATE for managed, so insert annotated fields should not be filled
    const db = await cds.connect.to('db')
    return db.tx(async () => {
      // REVISIT: Why do we allow overriding managed elements here?
      // provided values for managed annotated fields should be kept on DB level if provided
      await UPSERT.into('test.foo').entries({ ID: 3, modifiedBy: 'samuel' })

      const result = await SELECT.from('test.foo').where({ ID: 3 })
      expect(result).toEqual([
        {
          ID: 3,
          createdAt: null,
          createdBy: null,
          modifiedAt: expect.any(String),
          modifiedBy: 'samuel',
        },
      ])

      const { modifiedAt } = result[0]

      jest.advanceTimersByTime(1000)
      const now = new Date()
      const date1 = new Date(modifiedAt)

      expect(now.getTime() - date1.getTime()).toBeGreaterThan(0)
      expect(now.getTime() - date1.getTime()).toBeLessThan(10 * 1000) // 10s
    })
  })

  test('on insert is filled', async () => {
    const resPost = await POST('/test/foo', { ID: 4 })
    expect(resPost.status).toBe(201)

    expect(resPost.data).toEqual({
      '@odata.context': '$metadata#foo/$entity',
      ID: 4,
      createdAt: expect.any(String),
      createdBy: 'anonymous',
      modifiedAt: expect.any(String),
      modifiedBy: 'anonymous',
    })

    const { createdAt, modifiedAt } = resPost.data
    expect(createdAt).toEqual(modifiedAt)

    jest.advanceTimersByTime(1000)
    const now = new Date()
    const date1 = new Date(createdAt)

    expect(now.getTime() - date1.getTime()).toBeGreaterThan(0)
    expect(now.getTime() - date1.getTime()).toBeLessThan(10 * 1000) // 10s
  })

  test('on update is filled', async () => {
    const resPost = await POST('/test/foo', { ID: 5 })

    jest.advanceTimersByTime(1000)
    const resUpdate = await PUT('/test/foo(5)', {})
    expect(resUpdate.status).toBe(200)

    expect(resUpdate.data).toEqual({
      '@odata.context': '$metadata#foo/$entity',
      ID: 5,
      createdAt: resPost.data.createdAt,
      createdBy: resPost.data.createdBy,
      modifiedAt: expect.any(String),
      modifiedBy: 'anonymous',
    })

    const { createdAt, modifiedAt } = resUpdate.data
    expect(createdAt).not.toEqual(modifiedAt)

    const insertTime = new Date(createdAt)
    const updateTime = new Date(modifiedAt)

    expect(updateTime.getTime()).toBeGreaterThan(insertTime.getTime())
  })

  test('managed attributes are shared within a transaction', async () => {
    const db = await cds.connect.to('db')
    const tx = db.tx({ user: { id: 'tom' } })

    let result
    try {
      await tx.run(INSERT.into('test.foo').entries({ ID: 4711 }))
      await tx.run(INSERT.into('test.foo').entries({ ID: 4712 }))
      result = await tx.run(SELECT.from('test.foo').where('ID in', [4711, 4712]))
    } finally {
      await tx.rollback()
      expect(result[0].createdAt).toEqual(tx.context.timestamp.toISOString())
      expect(result[0].createdAt).toEqual(result[1].createdAt)
      expect(result[0].createdBy).toEqual('tom')
      expect(result[0].createdBy).toEqual(result[1].createdBy)
    }
  })
})
