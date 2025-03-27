const cds = require('../../../test/cds.js')

describe('Managed thingies', () => {
  const { POST, PUT, PATCH, expect } = cds.test(__dirname, 'model.cds')

  test('INSERT execute on db only', async () => {
    const db = await cds.connect.to('db')
    return db.tx(async () => {
      // REVISIT: Why do we allow overriding managed elements here?
      await INSERT.into('test.foo').entries({ ID: 2, modifiedBy: 'samuel' })

      const result = await SELECT.from('test.foo').where({ ID: 2 })
      expect(result).to.containSubset([
        {
          ID: 2,
          createdBy: 'anonymous',
          defaultValue: 100,
          modifiedBy: 'samuel',
        },
      ])
    })
  })

  test('UPSERT execute on db only', async () => {
    // UPSERT behaves like UPDATE for managed, so insert annotated fields should not be filled
    const db = await cds.connect.to('db')

    let modifications = []
    await db.tx(async () => {
      // REVISIT: Why do we allow overriding managed elements here?
      // provided values for managed annotated fields should be kept on DB level if provided
      await UPSERT.into('test.foo').entries({ ID: 3, modifiedBy: 'samuel' })

      const result = await SELECT.from('test.foo').where({ ID: 3 })
      expect(result).to.containSubset([
        {
          ID: 3,
          createdBy: "anonymous",
          defaultValue: 100,
          modifiedBy: 'samuel',
        },
      ])

      const row = result.at(-1)
      modifications.push(row)
      const { modifiedAt } = row
      expect(modifiedAt).to.eq(cds.context.timestamp.toISOString())
    })

    // Ensure that a second UPSERT updates the managed fields
    await db.tx(async () => {
      await UPSERT.into('test.foo').entries({ ID: 3 })

      const result = await SELECT.from('test.foo').where({ ID: 3 })
      expect(result).to.containSubset([
        {
          ID: 3,
          createdBy: "anonymous",
          defaultValue: 100,
          modifiedBy: 'anonymous',
        },
      ])

      const row = result.at(-1)
      modifications.push(row)
      const { modifiedAt } = row
      expect(modifiedAt).to.eq(cds.context.timestamp.toISOString())
      // expect(modifiedAt).not.to.eq(modifications.at(-2).modifiedAt) // REVISIT: This frequently fails on fast machines
    })
  })

  test('on insert is filled', async () => {
    const resPost = await POST('/test/foo', { ID: 4 })
    expect(resPost.status).to.equal(201)

    expect(resPost.data).to.containSubset({
      '@odata.context': '$metadata#foo/$entity',
      ID: 4,
      createdBy: 'anonymous',
      defaultValue: 100,
      modifiedBy: 'anonymous',
    })

    const { createdAt, modifiedAt } = resPost.data
    expect(createdAt).to.eq(modifiedAt)
  })

  test('on update is filled', async () => {
    const resPost = await POST('/test/foo', { ID: 5, defaultValue: 50 })

    // patch keeps old defaults
    const resUpdate1 = await PATCH('/test/foo(5)', {})
    expect(resUpdate1.status).to.eq(200)

    expect(resUpdate1.data).to.containSubset({
      '@odata.context': '$metadata#foo/$entity',
      ID: 5,
      createdAt: resPost.data.createdAt,
      createdBy: resPost.data.createdBy,
      defaultValue: 50, // not defaulted to 100 on update
      modifiedBy: 'anonymous',
    })

    // put overwrites not provided defaults
    const resUpdate2 = await PUT('/test/foo(5)', {})
    expect(resUpdate2.status).to.eq(200)

    expect(resUpdate2.data).to.containSubset({
      '@odata.context': '$metadata#foo/$entity',
      ID: 5,
      createdAt: resPost.data.createdAt,
      createdBy: resPost.data.createdBy,
      defaultValue: 100,
      modifiedBy: 'anonymous',
    })

    const { createdAt, modifiedAt } = resUpdate1.data
    expect(createdAt).not.to.eq(modifiedAt)

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
