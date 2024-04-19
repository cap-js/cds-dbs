const { Readable } = require('stream')
const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

// Stress test should not be run in the pipeline
describe.skip('Bookshop - Insert', () => {
  cds.test(bookshop)

  test('Large (~33 mil rows)', async () => {
    const { Books } = cds.entities('sap.capire.bookshop')

    // Postgres
    // json (1 << 25) -> 5 min (with WAL warnings)
    // jsonb (1 << 24) -> size limit reached
    // json (1 << 23) -> 82.148 sec
    // jsonb (1 << 23) -> 52.148 sec
    // json (1 << 10) -> 2.35 sec
    // jsonb (1 << 10) -> 2.62 sec

    let totalRows = (1 << 20)
    let totalSize = 0
    const bufferSize = 1 << 16
    const stream = Readable.from((function* () {
      let buffer = '['
      let i = 1000
      const target = i + totalRows
      buffer += `{"ID":${i++}}`
      for (; i < target;) {
        buffer += `,{"ID":${i++}}`
        if (buffer.length >= bufferSize) {
          totalSize += buffer.length
          yield buffer
          buffer = ''
        }
      }
      buffer += ']'
      totalSize += buffer.length
      yield buffer
    })(), { objectMode: false })
    const s = performance.now()
    await INSERT(stream).into(Books)
    process.stdout.write(`total size: ${totalSize} total rows: ${totalRows} rows/ms: (${totalRows / (performance.now() - s)})\n`)
  }, 60 * 60 * 1000)
})
