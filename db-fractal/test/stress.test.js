const cds = require('../../test/cds')

const bookshop = cds.utils.path.resolve(__dirname, '../../test/bookshop')

// Cache toggle
process.env.FRACTAL_CACHE = 'false'

describe('stress', () => {
  beforeAll(() => {
    cds.requires.postgres = require('../../postgres/test/service.json')
    cds.requires.sqlite = require('../../sqlite/test/service.json')
  })

  const { expect, GET } = cds.test(bookshop)

  beforeEach(async () => {
    await cds.disconnect()
    delete cds.services.db
    await cds.deploy(cds.options.from).to('db')
  })

  test.each([1, 10, 100, 1000])('test', async (queryCount) => {
    const { Books } = cds.entities('sap.capire.bookshop')
    let start, queries

    process.stdout.write(`queries : ${queryCount}\n`)

    // Apply write operation to source database
    await INSERT({ ID: 999 }).into(Books)

    // Cold run includes creating cache
    queries = new Array(queryCount).fill('').map(() => SELECT.from(Books))
    start = performance.now()
    await Promise.all(queries)
    // cache: ~160ms no-cache: ~270ms
    process.stdout.write(`cold :${(`${(((performance.now() - start) * 100) >>> 0) / 100}`.padStart(7, ' '))}ms\n`)

    // Hot run already has cache created
    queries = new Array(queryCount).fill('').map(() => SELECT.from(Books))
    start = performance.now()
    await Promise.all(queries)
    // cache: ~40ms no-cache: ~270ms
    process.stdout.write(` hot :${(`${(((performance.now() - start) * 100) >>> 0) / 100}`.padStart(7, ' '))}ms\n`)

    // Apply write operations to local cache
    await DELETE(Books).where({ ID: 201 })
    await INSERT({ ID: 998 }).into(Books)
    await UPDATE(Books).with({ descr: 'UPDATED' }).where({ ID: 251 })
    const cache = await SELECT.from(Books)

    // Invalidate Books cache token
    cds.db._tokens[`${undefined}:${SELECT.from(Books).target}`].validTo = 0
    const source = await SELECT.from(Books)

    expect(source).to.deep.equal(cache)
  }, 30 * 1000)
})