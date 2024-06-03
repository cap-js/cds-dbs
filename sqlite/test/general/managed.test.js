const cds = require('../../../test/cds.js')

describe('Managed thingies', () => {
  const { POST, PUT, sleep, expect } = cds.test(__dirname, 'model.cds')

  test('INSERT execute on db only', async () => {
    const db = await cds.connect.to('db')
    return db.tx(async () => {
      // REVISIT: Why do we allow overriding managed elements here?
      await INSERT.into('test.foo').entries({ ID: 2, modifiedBy: 'samuel' })

      const result = await SELECT.from('test.foo').where({ ID: 2 })
      expect(result).to.containSubset([
        {
          ID: 2,
          // createdAt: expect.any(String),
          createdBy: 'anonymous',
          // modifiedAt: expect.any(String),
          modifiedBy: 'samuel',
        },
      ])
    })
  })

  test('UPSERT execute on db only', async () => {
    // UPSERT behaves like UPDATE for managed, so insert annotated fields should not be filled
    const db = await cds.connect.to('db')
    return db.run(async () => {
      // REVISIT: Why do we allow overriding managed elements here?
      // provided values for managed annotated fields should be kept on DB level if provided
      await UPSERT.into('test.foo').entries({ ID: 3, modifiedBy: 'samuel' })

      const result = await SELECT.from('test.foo').where({ ID: 3 })
      expect(result).to.containSubset([
        {
          ID: 3,
          createdAt: null,
          createdBy: null,
          // modifiedAt: expect.any(String),
          modifiedBy: 'samuel',
        },
      ])

      const { modifiedAt } = result[0]
      expect(modifiedAt).to.equal(cds.context.timestamp.toISOString())

      await sleep(11) // ensure some ms are passed
      const modified = new Date(modifiedAt).getTime()
      const now = Date.now()

      expect(now - modified).to.be.greaterThan(0)
      expect(now - modified).to.be.lessThan(10 * 1000) // 10s
    })
  })

  test('on insert is filled', async () => {
    const resPost = await POST('/test/foo', { ID: 4 })
    expect(resPost.status).to.equal(201)

    expect(resPost.data).to.containSubset({
      '@odata.context': '$metadata#foo/$entity',
      ID: 4,
      // createdAt: expect.any(String),
      createdBy: 'anonymous',
      // modifiedAt: expect.any(String),
      modifiedBy: 'anonymous',
    })

    const { createdAt, modifiedAt } = resPost.data
    expect(createdAt).to.equal(modifiedAt)

    await sleep(11) // ensure some ms are passed
    const now = Date.now()
    const created = new Date(createdAt).getTime()

    expect(now - created).to.be.greaterThan(0)
    expect(now - created).to.be.lessThan(10 * 1000) // 10s
  })

  test('on update is filled', async () => {
    const resPost = await POST('/test/foo', { ID: 5 })

    const resUpdate = await PUT('/test/foo(5)', {})
    expect(resUpdate.status).to.equal(200)

    expect(resUpdate.data).to.containSubset({
      '@odata.context': '$metadata#foo/$entity',
      ID: 5,
      createdAt: resPost.data.createdAt,
      createdBy: resPost.data.createdBy,
      // modifiedAt: expect.any(String),
      modifiedBy: 'anonymous',
    })

    const { createdAt, modifiedAt } = resUpdate.data
    expect(createdAt).not.to.equal(modifiedAt)

    const insertTime = new Date(createdAt).getTime()
    const updateTime = new Date(modifiedAt).getTime()

    expect(updateTime).to.be.greaterThan(insertTime)
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
      expect(result[0].createdAt).to.equal(tx.context.timestamp.toISOString())
      expect(result[0].createdAt).to.equal(result[1].createdAt)
      expect(result[0].createdBy).to.equal('tom')
      expect(result[0].createdBy).to.equal(result[1].createdBy)
    }
  })
})
