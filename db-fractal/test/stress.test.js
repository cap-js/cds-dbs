const cds = require('../../test/cds')

const bookshop = cds.utils.path.resolve(__dirname, '../../test/bookshop')

describe('stress', () => {
  beforeAll(() => {
    cds.requires.postgres = require('../../postgres/test/service.json')
    cds.requires.sqlite = require('../../sqlite/test/service.json')
  })

  const { expect, GET } = cds.test(bookshop)

  test('test', async () => {
    try {
      const { Books } = cds.entities('sap.capire.bookshop')
      let start, queries

      // Cold run includes creating cache
      queries = new Array(100).fill('').map(() => SELECT.from(Books))
      start = performance.now()
      await Promise.all(queries)
      // cache: ~160ms no-cache: ~270ms
      console.log('cold', performance.now() - start, 'ms')

      // Hot run already has cache created
      queries = new Array(100).fill('').map(() => SELECT.from(Books))
      start = performance.now()
      await Promise.all(queries)
      // cache: ~40ms no-cache: ~270ms
      console.log('hot', performance.now() - start, 'ms')
    } catch (err) {
      debugger
    }
  })
})