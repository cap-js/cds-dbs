const cds = require('../../../test/cds')

describe('UUID Generation', () => {
  const { POST, PUT, GET, expect } = cds.test(__dirname, 'deep.cds')

  test('generate UUID on insert', async () => {
    const uuid = cds.utils.uuid()
    const res = await POST('/bla/RootUUID', {
      ID: uuid,
      toOneChild: {
        text: 'abc',
        toManySubChild: [{ text: 'a' }, { text: 'b' }],
      },
    })
    expect(res.status).to.equal(201)

    expect(res.data).to.containSubset({
      ID: uuid,
      name: null,
      toOneChild: {
        text: 'abc',
        toManySubChild: [{ text: 'a' }, { text: 'b' }],
      },
    })

    // uuid is properly generated
    expect(res.data.toOneChild.ID).to.exist
    // and propagated
    expect(res.data.toOneChild.ID).to.equal(res.data.toOneChild_ID)
    // uuid is properly generated
    expect(res.data.toOneChild.toManySubChild[0].ID).to.exist
    expect(res.data.toOneChild.toManySubChild[1].ID).to.exist
    // and propagated
    expect(res.data.toOneChild.ID).to.equal(res.data.toOneChild.toManySubChild[0].backlink_ID)
    expect(res.data.toOneChild.ID).to.equal(res.data.toOneChild.toManySubChild[1].backlink_ID)
  })
  test('generate UUID on update', async () => {
    const uuid = cds.utils.uuid()
    const resPost = await POST('/bla/RootUUID', {
      ID: uuid,
      toOneChild: {
        text: 'abc',
        toManySubChild: [{ text: 'a' }, { text: 'b' }],
      },
    })
    expect(resPost.status).to.equal(201)

    // new children are created
    const resUpdate = await PUT(`/bla/RootUUID(${uuid})`, {
      toOneChild: {
        text: 'abc',
        toManySubChild: [{ text: 'a' }, { text: 'b' }],
      },
    })
    expect(resUpdate.status).to.equal(200)

    const resRead = await GET(`/bla/RootUUID(${uuid})?$expand=toOneChild($expand=toManySubChild)`)

    // foreign keys are set correctly (deep)
    expect(resRead.data.toOneChild.ID).to.equal(resRead.data.toOneChild_ID)
    expect(resRead.data.toOneChild.ID).to.equal(resRead.data.toOneChild.toManySubChild[0].backlink_ID)
    expect(resRead.data.toOneChild.ID).to.equal(resRead.data.toOneChild.toManySubChild[1].backlink_ID)
  })

  test('generate UUID on update programmatically', async () => {
    const uuid = cds.utils.uuid()
    await cds.db
      .insert({
        ID: uuid,
        toOneChild: {
          text: 'abc',
          toManySubChild: [{ text: 'a' }, { text: 'b' }],
        },
      })
      .into('bla.RootUUID')

    const inserted = await cds.db.read('bla.RootUUID', { ID: uuid }).columns(c => {
      c`.*`,
        c.toOneChild(c1 => {
          c1`.*`, c1.toManySubChild('*')
        })
    })

    // new children are created
    await cds.db.update('bla.RootUUID', { ID: uuid }).set({
      toOneChild: {
        // we omit the UUID --> insert
        text: 'abc',
        toManySubChild: [{ text: 'a' }, { text: 'b' }], // we omit the UUIDs --> insert
      },
    })
    const updated = await cds.db.read('bla.RootUUID', { ID: uuid }).columns(c => {
      c`.*`,
        c.toOneChild(c1 => {
          c1`.*`, c1.toManySubChild('*')
        })
    })

    // in the query `select … { *, toOneChild { … } }` the expand actually replaces the
    // the association `toOneChild` from the wildcard, hence `updated.toOneChild_ID === undefined`
    // expect(updated.toOneChild.ID).to.equal(updated.toOneChild_ID)

    // foreign keys are set correctly (deep)
    expect(updated.toOneChild.ID).to.equal(updated.toOneChild.toManySubChild[0].backlink_ID)
    expect(updated.toOneChild.ID).to.equal(updated.toOneChild.toManySubChild[1].backlink_ID)

    // new IDs are generated (deep)
    expect(inserted.toOneChild.ID).not.to.equal(updated.toOneChild.ID)
    expect(inserted.toOneChild.toManySubChild[0].ID).not.to.equal(updated.toOneChild.toManySubChild[0].ID)
    expect(inserted.toOneChild.toManySubChild[1].ID).not.to.equal(updated.toOneChild.toManySubChild[1].ID)
  })

  test('update root and delete child', async () => {
    const uuid = cds.utils.uuid()
    const resPost = await POST('/bla/RootUUID', {
      ID: uuid,
      toOneChild: {
        text: 'abc',
      },
    })
    expect(resPost.status).to.equal(201)

    // child should be deleted
    const resUpdate = await PUT(`/bla/RootUUID(${uuid})`, {
      toOneChild: null,
    })
    expect(resUpdate.status).to.equal(200)
    expect(resUpdate.data).to.containSubset({
      '@odata.context': '$metadata#RootUUID/$entity',
      ID: uuid,
      name: null,
    })

    const resRead = await GET(`/bla/RootUUID(${uuid})?$expand=toOneChild`)
    expect(resRead.data).to.containSubset({
      ID: uuid,
      name: null,
      toOneChild: null,
    })
  })

  test('update on projection root', async () => {
    const resPost = await POST('/bla/SProjRoot', {
      rID: 1,
      rToOneChild: {
        rID: 2,
        rText: 'abc',
      },
    })
    expect(resPost.status).to.equal(201)
  })
})
