const cds = require('../../../test/cds')

describe('deep operations with @cds.persistence.skip', () => {
  const { POST, PUT, DELETE, expect } = cds.test(__dirname, 'deep.cds')

  test('skip child to one with @cds.persistence.skip on deep insert', async () => {
    const uuid = cds.utils.uuid()
    const res = await POST('/bla/RootUUID', {
      ID: uuid,
      toOneSkip: {
        text: 'abc',
      },
    })
    expect(res.status).to.equal(201)

    expect(res.data).to.containSubset({
      ID: uuid,
      name: null,
      toOneChild_ID: null,
      // toOneSkip_ID: expect.any(String),
    })
    expect(res.data.toOneSkip_ID).to.exist
  })

  test('skip child to many with @cds.persistence.skip on deep insert', async () => {
    const uuid = cds.utils.uuid()
    const res = await POST('/bla/RootUUID', {
      ID: uuid,
      toManySkip: [{ text: 'a' }, { text: 'b' }],
    })
    expect(res.status).to.equal(201)

    expect(res.data).to.containSubset({
      ID: uuid,
      name: null,
      toOneChild_ID: null,
      toOneSkip_ID: null,
    })
  })

  test('skip nested child to one with @cds.persistence.skip on deep insert', async () => {
    const uuid = cds.utils.uuid()
    const res = await POST('/bla/RootUUID', {
      ID: uuid,
      toOneChild: {
        text: 'abc',
        toManySubChild: [
          { text: 'a', toOneSkipChild: { text: 'aa' } },
          { text: 'b', toOneSkipChild: { text: 'bb' } },
        ],
      },
    })
    expect(res.status).to.equal(201)

    expect(res.data).to.containSubset({
      ID: uuid,
      name: null,
      toOneChild: {
        // ID: expect.any(String),
        text: 'abc',
        toManySubChild: [
          {
            // ID: expect.any(String),
            backlink_ID: res.data.toOneChild.ID,
            text: 'a',
            // toOneSkipChild_ID: expect.any(String),
          },
          {
            // ID: expect.any(String),
            backlink_ID: res.data.toOneChild.ID,
            text: 'b',
            // toOneSkipChild_ID: expect.any(String),
          },
        ],
      },
      toOneChild_ID: res.data.toOneChild.ID,
      toOneSkip_ID: null,
    })
  })

  test('skip child to one with @cds.persistence.skip on deep update', async () => {
    const uuid = cds.utils.uuid()
    const resPost = await POST('/bla/RootUUID', {
      ID: uuid,
      toOneSkip: {
        text: 'abc',
      },
    })
    expect(resPost.status).to.equal(201)

    const resUpdate = await PUT(`/bla/RootUUID(${uuid})`, {
      name: 'abc',
      toOneSkip: {
        text: 'cd',
      },
    })
    expect(resUpdate.status).to.equal(200)

    expect(resUpdate.data).to.containSubset({
      '@odata.context': '$metadata#RootUUID/$entity',
      ID: uuid,
      name: 'abc',
      toOneChild_ID: null,
      // toOneSkip_ID: expect.any(String),
    })
  })

  test('skip child to one with @cds.persistence.skip on deep delete', async () => {
    const uuid = cds.utils.uuid()
    const resPost = await POST('/bla/RootUUID', {
      ID: uuid,
      toOneSkip: {
        text: 'abc',
      },
    })
    expect(resPost.status).to.equal(201)

    const resUpdate = await DELETE(`/bla/RootUUID(${uuid})`)
    expect(resUpdate.status).to.equal(204)
  })
})
