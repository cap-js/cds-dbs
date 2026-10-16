const { Readable } = require('stream')

const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

const vacuum = true

describe('Bookshop - Stream Performance', () => {
  cds.test(bookshop)

  beforeAll(async () => {
    cds.db.pools._factory.options = {
      max: 50,
      min: 0,
      acquireTimeoutMillis: undefined, // Disabled to allow the database pool to queue the INSERT statements
      idleTimeoutMillis: 7500,
      softIdleTimeoutMillis: 7500
    }
    await cds.disconnect()
  })

  const rawData = (start, end) => {
    const gen = function* () {
      let i = start
      yield `[{"ID":${i++},"title":"${i}","author_ID":101,"genre_ID":11}`
      for (; i < end; i++) {
        yield `,{"ID":${i},"title":"${i}","author_ID":101,"genre_ID":11}`
      }
      yield ']'
    }
    return Readable.from(gen(), { objectMode: false })
  }
  const objectData = (start, end) => {
    return (function* () {
      let i = start
      for (; i < end; i++) {
        yield {
          ID: i,
          title: `${i}`,
          author_ID: 101,
          genre_ID: 11
        }
      }
    })()
  }
  const objectDataArray = (start, end) => ([...objectData(start, end)])

  const getData = objectDataArray || objectData || rawData

  const tests = [
    {
      method: 'INSERT',
      getData,
      connections: 50,
    },
    {
      method: 'INSERT',
      getData,
      chunkSize: 5000,
    },
    {
      method: 'UPSERT',
      getData,
      connections: 50,
    },
    {
      method: 'UPSERT',
      getData,
      chunkSize: 5000,
    },
  ]

  const massData = async function ({ method, getData, connections, chunkSize }, { rows }) {
    const { Books } = cds.entities('sap.capire.bookshop')

    const step = chunkSize || Math.ceil(rows / connections)
    const proms = new Array(
      chunkSize
        ? Math.ceil(rows / chunkSize)
        : connections
    )
      .fill('')
      .map(async (_, i) => cds.tx(async () => cds.ql[method](getData(step * i, step * (i + 1))).into(Books)))
    const errors = await Promise.allSettled(proms)
    const result = await SELECT.one`count(*)`.from(Books)
    console.log('method:', method, 'errors:', errors.map(r => r.reason).filter(a => a), 'count:', result.count)
  }

  beforeEach(async () => {
    const { Books } = cds.entities('sap.capire.bookshop')
    await DELETE.from(Books).where([{ val: 1 }])

    if (vacuum) {
      await cds.tx(async tx => {
        await tx.run('COMMIT')
        // VACUUM has to be called outside of any transaction
        await tx.run("VACUUM (FULL)")
      })
    }
  }, 2 * 60 * 1000)

  describe.each(tests)('mass $method', (config) => {
    const sizes = [
      { rows: 1 << 8 },
      { rows: 1 << 16 },
      { rows: 1 << 20 },
      { rows: 1 << 22 },
      // { rows: 1 << 24 },
    ]

    test.each(sizes)('rows: ~$rows', massData.bind(null, config), 5 * 60 * 1000)
  })
})