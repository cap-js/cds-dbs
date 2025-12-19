const fs = require('fs')
const path = require('path')
const { Readable, Writable } = require('stream')
const { pipeline } = require('stream/promises')
const streamConsumers = require('stream/consumers')

const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

describe.skip('Bookshop: Stream Performance', () => {
  cds.test(bookshop)

  const imageData = fs.readFileSync(path.join(__dirname, '../../../sqlite/test/general/samples/test.jpg'))

  let numberOfBooks = 0
  beforeAll(async () => {
    const { Books } = cds.entities('sap.capire.bookshop')

    let i = 1000
    const gen = function* () {
      yield `[{"ID":${i++},"title":"${i}","author_ID":101,"genre_ID":11}`
      for (; i < 100_000; i++) {
        yield `,{"ID":${i},"title":"${i}","author_ID":101,"genre_ID":11}`
      }
      yield ']'
    }
    await INSERT(Readable.from(gen(), { objectMode: false })).into(Books)
    process.stdout.write(`DEPLOYED\n`)
    numberOfBooks = (i - 1000 + 4)
  })

  const measure = [
    { async: false },
    { async: true },
  ]

  const modes = [
    { objectMode: false },
    // { objectMode: true },
    // { objectMode: null },
  ]

  const scenarios = [
    { withImage: false, withExpands: false },
    // { withImage: false, withExpands: true },
    // { withImage: true, withExpands: false },
    // { withImage: true, withExpands: true },
  ]

  describe.each(measure)('$async', ({ async }) => {

    beforeAll(() => { process.stdout.write(`- ${async ? 'async' : 'sync'}\n`) })

    describe.each(modes)('$objectMode', ({ objectMode }) => {

      beforeAll(() => { process.stdout.write(`  - ${objectMode ? 'objectMode' : objectMode == null ? 'array' : 'raw'}\n`) })

      it.each(scenarios)('$withImage $withExpands', async ({ withImage, withExpands }) => {

        if (scenarios.length > 1) process.stdout.write(`    - Books ${withImage ? '+image ' : ''}${withExpands ? '+expand' : ''}\n`)

        const { Books } = cds.entities('sap.capire.bookshop')

        await UPDATE(Books).with({ image: withImage ? imageData : null }).where({ val: true })

        const query = SELECT([
          '*',
          ...(withImage ? [{ ref: ['image'] }] : []),
          ...(withExpands ? [{ ref: ['author'], expand: ['*'] }, { ref: ['genre'], expand: ['*'] }] : []),
        ]).from(Books)
        const req = new cds.Request({ query, iterator: objectMode == null ? false : true, objectMode })

        const rows = numberOfBooks * (withExpands ? 3 : 1)

        let peakMemory = 0
        const proms = []
        const txs = await Promise.all(new Array(20).fill().map(async () => (await cds.tx()).begin()))
        const s = performance.now()
        let fastest = Number.POSITIVE_INFINITY

        for (let total = 0; total < 100; total++) {
          const tx = txs[total % txs.length]
          proms.push((async () => {
            const s = performance.now()
            const stream = await tx.dispatch(req)
            await pipeline(stream, devNull())
            const dur = performance.now() - s
            if (dur < fastest) fastest = dur
            const curMemory = process.memoryUsage().heapUsed
            if (curMemory > peakMemory) peakMemory = curMemory
          })())
          if (async === false) await proms.at(-1)
        }

        const allResults = await Promise.allSettled(proms)
        const success = allResults.filter(r => r.status === 'fulfilled')

        const dur = performance.now() - s
        const totalRows = rows * success.length
        process.stdout.write(
          `${scenarios.length > 1 ? '  ' : ''}    - Duration: ${dur >>> 0} ms Rows: ${totalRows} (${(totalRows / dur) >>> 0} rows/ms) (${(peakMemory / 1024 / 1024) >>> 0} MiB mem)\n`
        )
        process.stdout.write(
          `${scenarios.length > 1 ? '  ' : ''}    - Fastest: ${fastest >>> 0} ms Rows: ${rows} (${(rows / fastest) >>> 0} rows/ms)\n`
        )
        await Promise.all(txs.map(tx => tx.commit()))

      }, 120 * 1000)

    })

  })

})

const devNull = function () {
  return new Writable({
    objectMode: true, write(chunk, encoding, callback) {
      callback()
    }
  })
}