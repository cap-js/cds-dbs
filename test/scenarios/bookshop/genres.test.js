const cds = require('../../cds.js')
const bookshop = require('path').resolve(__dirname, '../../bookshop')
const assert = require('assert')
const admin = {
  auth: {
    username: 'alice',
  },
}

describe('Bookshop - Genres', () => {
  const { expect, GET, POST, PUT, DELETE } = cds.test(bookshop)

  test('Delete Genres', async () => {
    const body = require('./genres.json')

    const beforeData = await GET('/test/Genres', admin)

    await POST('/test/Genres', body, admin)

    const res = await DELETE(`/test/Genres(${body.ID})`, admin)
    expect(res.status).to.be.eq(204)

    const afterData = await GET('/test/Genres', admin)

    delete res.data['@odata.context']
    assert.deepEqual(beforeData.data, afterData.data)
  })

  test('Insert Genres', async () => {
    const body = require('./genres.json')

    const insertResponse = await POST('/test/Genres', body, admin)
    expect(insertResponse.status).to.be.eq(201)

    delete insertResponse.data['@odata.context']

    // Read after write does not sort the results
    // therefor asynchronious databases might return in different orders
    const sort = (a, b) => {
      if (!a?.children || !b?.children) return
      const order = b.children.reduce((l, c, i) => { l[c.ID] = i; return l }, {})
      a.children.sort((a, b) => order[a.ID] - order[b.ID])
      a.children.forEach((c, i) => sort(c, b.children[i]))
    }

    sort(insertResponse.data, body)
    assert.deepEqual(insertResponse.data, body)

    // REVISIT clean up so the deep update test does not fail
    await DELETE(`/test/Genres(${body.ID})`, admin)
  })

  test('Update Genres', async () => {
    // This was UPSERT before
    const get = await GET('/test/Genres(10)', admin)

    const res = await PUT(`/test/Genres(10)`, { name: get.data.name + ' changed' }, admin)
    expect(res.status).to.be.eq(200)

    assert.deepEqual({ ...get.data, name: get.data.name + ' changed' }, res.data)
  })

  test('Deep Update Genres', async () => {
    // REVISIT this test fails
    let body = require('./genres.json')

    // add all the data from genres.json deep
    await POST('/test/Genres', body, admin)

    // deep update, which deletes all children of 100 and inserts one new children
    let res = await PUT(`/test/Genres(${body.ID})`, { name: 'everything changed', children: [{ ID: 999 }] }, admin)
    expect(res.status).to.be.eq(200)

    const check = (result, comparator, entries) => {
      const fn = comparator === 'includes' ? e => result.some(row => row.ID === e) : e => result.every(row => row.ID !== e)
      const msg = `result does ${comparator === 'includes' ? 'not include all' : 'include some of'} IDs: ${entries}`
      return [entries.every(fn), msg]
    }

    res = await GET('/test/Genres', admin)
    assert.ok(...check(res.data.value, 'includes', [100,999])) // referenced in payload
    assert.ok(...check(res.data.value, 'does not include', [102, 103, 104, 105, 106, 107])) // all other children have been removed

    res = await PUT(`/test/Genres(${body.ID})`, { name: 'no more children', children: [] }, admin)
    expect(res.status).to.be.eq(200)

    res = await GET(`/test/Genres`, admin)
    assert.ok(...check(res.data.value, 'includes', [100]))
    assert.ok(...check(res.data.value, 'does not include', [999]))
  })
})
