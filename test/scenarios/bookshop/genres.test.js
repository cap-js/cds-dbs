const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../../cap/samples/bookshop')

const admin = {
  auth: {
    username: 'alice',
  },
}

describe('Bookshop - Genres', () => {
  const { expect, GET, POST, PUT, DELETE } = cds.test(bookshop, 'test/genres.cds')

  test('Delete Genres', async () => {
    const body = require('./genres.json')

    const beforeData = await GET('/odata/v4/test/Genres', admin)

    await POST('/odata/v4/test/Genres', body, admin)

    const res = await DELETE(`/odata/v4/test/Genres(${body.ID})`, admin)
    expect(res.status).to.be.eq(204)

    const afterData = await GET('/odata/v4/test/Genres', admin)

    delete res.data['@odata.context']
    const assert = require('assert')
    assert.deepEqual(beforeData.data, afterData.data)
  })

  test('Insert Genres', async () => {
    const body = require('./genres.json')

    const insertResponse = await POST('/odata/v4/test/Genres', body, admin)
    expect(insertResponse.status).to.be.eq(201)

    delete insertResponse.data['@odata.context']
    const assert = require('assert')

    // Read after write does not sort the results
    // therefor asynchronious databases might return in different orders
    const sort = (a, b) => {
      if (!a?.children || !b?.children) return
      const order = b.children.reduce((l, c, i) => { l[c.ID] = i; return l }, {})
      a.children.sort((a, b) => order[a.ID] - order[b.ID])
      a.children.forEach((c, i) => sort(c, b.children[i]))
    }

    // REVISIT clean up so the deep update test does not fail
    await DELETE(`/odata/v4/test/Genres(${body.ID})`, admin)

    sort(insertResponse.data, body)
    assert.deepEqual(insertResponse.data, body)
  })

  test('Update Genres', async () => {
    // This was UPSERT before
    const get = await GET('/odata/v4/test/Genres(10)', admin)

    const res = await PUT(`/odata/v4/test/Genres(10)`, { name: get.data.name + ' changed' }, admin)
    expect(res.status).to.be.eq(200)

    const assert = require('assert')
    assert.deepEqual({ ...get.data, name: get.data.name + ' changed' }, res.data)
  })

  test('Deep Update Genres', async () => {
    // REVISIT this test fails
    let body = require('./genres.json')

    // add all the data from genres.json deep
    await POST('/odata/v4/test/Genres', body, admin)

    // deep update, which deletes all children of 100 and inserts one new children
    let res = await PUT(`/odata/v4/test/Genres(${body.ID})`, { name: 'everything changed', children: [{ ID: 999 }] }, admin)
    expect(res.status).to.be.eq(200)

    res = await GET(`/odata/v4/test/Genres(${body.ID})?$expand=children`, admin)

    expect(res.status).to.be.eq(200)
    delete res.data['@odata.context']
    const assert = require('assert')
    assert.deepEqual(res.data, {
      name: 'everything changed',
      descr: null,
      ID: 100,
      parent_ID: null,
      children: [{ name: null, descr: null, ID: 999, parent_ID: 100 }], // all other children have been removed
    })

    res = await PUT(`/odata/v4/test/Genres(${body.ID})`, { name: 'no more children', children: [] }, admin)
    expect(res.status).to.be.eq(200)

    res = await GET(`/odata/v4/test/Genres(${body.ID})?$expand=children`, admin)
    expect(res.data).to.deep.include({
      name: 'no more children',
      descr: null,
      ID: 100,
      parent_ID: null,
      children: [], // all children have been removed
    })
  })
})
