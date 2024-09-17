const { Readable } = require('stream')
const streamConsumer = require('stream/consumers')

const cds = require('../../cds.js')
const bookshop = require('path').resolve(__dirname, '../../bookshop')

const admin = {
  auth: {
    username: 'alice',
  },
}

describe('Bookshop - Genres', () => {
  const { expect, GET, POST, PUT, DELETE } = cds.test(bookshop, 'test/genres.cds')

  test('Delete Genres', async () => {
    const body = require('./genres.json')

    const beforeData = await GET('/test/Genres', admin)

    await POST('/test/Genres', body, admin)

    const res = await DELETE(`/test/Genres(${body.ID})`, admin)
    expect(res.status).to.be.eq(204)

    const afterData = await GET('/test/Genres', admin)

    delete res.data['@odata.context']
    const assert = require('assert')
    assert.deepEqual(beforeData.data, afterData.data)
  })

  test.only('Insert Genres', async () => {
    throw new Error(`DON'T MERGE CURRENT STATE IT IS NOT CLEANED UP!!!`)

    const { Genres } = cds.entities('sap.capire.bookshop')

    // Large deep genres generation code
    const maxID = 100000

    let width = 1
    let height = 1

    while (width ** height <= maxID) {
      width++
      if (width ** height >= maxID) break
      height++
    }

    let currentID = 1
    const makeGenreGenerator = function* (depth = 0) {
      const ID = currentID++
      yield `{"ID":${ID},"name":"Genre ${ID}","children":[`

      depth++
      if (depth <= height) {
        let sep = ''
        for (let i = 0; i < width; i++) {
          yield sep
          sep = ','
          for (const chunk of makeGenreGenerator(depth)) {
            yield chunk
          }
        }
      }

      yield ']}'
    }

    if (false) {
      // Start hard coded experimental procedure
      await cds.tx(async db => {
        const bodyStream = () => Readable.from(makeGenreGenerator(), { objectMode: false })
        const body = await streamConsumer.text(bodyStream())

        await db.begin()

        await db.exec(`${cds.utils.fs.readFileSync(__dirname + '/deep-insert-mapper.sql')}`)
        const ps = await db.prepare(`${cds.utils.fs.readFileSync(__dirname + '/deep-insert-mapped.sql')}`)
        for (let i = 0; i < 0; i++) {
          await cds.ql.DELETE.from(Genres)
          const s = performance.now()
          const res = await ps.proc([body], [{ PARAMETER_NAME: 'ret' }])
          process.stdout.write(`INSERT MAPPED (rows ${currentID - 1}) ${performance.now() - s}\n`)
        }
        const after = await db.exec(`SELECT * FROM sap_capire_bookshop_Genres`)
        // const proc = await cds.run(, [{ input: body }])
      })
    }
    // Start of an actual test

      const db = await cds.connect.to('db')
      const bodyStream = () => Readable.from(makeGenreGenerator(), { objectMode: false })
      const _bodyCache = await streamConsumer[db._deepSQL ? 'text' : 'json'](bodyStream())
      const body = () => db._deepSQL
        ? Readable.from((function* () { yield _bodyCache })(), { objectMode: false })
        : _bodyCache

      for (let i = 0; i < 1000; i++) {
        await cds.ql.DELETE.from(Genres)//.where('1=1')
        const s = performance.now()
        await cds.ql.INSERT(body()).into(Genres)
        process.stdout.write(`DEEP INSERT (rows: ${currentID - 1}) ${performance.now() - s}\n`)
      }

      // await cds.ql.INSERT({ ID: 1 }).into(Genres)

      // await cds.ql.UPDATE(Genres).data(body).where(`ID=${1}`)
      // await cds.ql.UPDATE(Genres).data(body).where(`ID=${1}`)

      // const changes = await cds.ql.INSERT(body).into(Genres)
      const after = await cds.ql.SELECT.from(Genres)
      expect(after.length).to.equal(currentID - 1)



    const insertResponse = await POST('/test/Genres', body, admin)
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

    const assert = require('assert')
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

    res = await GET(`/test/Genres(${body.ID})?$expand=children`, admin)

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

    res = await PUT(`/test/Genres(${body.ID})`, { name: 'no more children', children: [] }, admin)
    expect(res.status).to.be.eq(200)

    res = await GET(`/test/Genres(${body.ID})?$expand=children`, admin)
    expect(res.data).to.deep.include({
      name: 'no more children',
      descr: null,
      ID: 100,
      parent_ID: null,
      children: [], // all children have been removed
    })
  })
})
