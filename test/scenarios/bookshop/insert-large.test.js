const { Readable } = require('stream')
const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

// Stress test should not be run in the pipeline
describe.skip('Bookshop - Insert', () => {
  cds.test(bookshop)

  test('entries vs rows', async () => {
    const maxRows = 1e6

    const { Authors } = cds.entities

    let hasData = true
    const filename = cds.utils.path.resolve(__dirname, 'Authors')
    const files = {}
    for (let i = 1; i <= maxRows; i *= 10) {
      files[i] = cds.utils.fs.existsSync(`${filename}-${i}.json`)
      hasData = hasData && files[i]
    }

    if (!hasData) { // Generate data using the cds-dk data generator
      const data = require('@sap/cds-dk/lib/init/template/data')

      const books = Authors.elements.books
      delete Authors.elements.books // prevent children from being generated

      for (let i = 1; i <= maxRows; i *= 10) {
        files[i] = cds.utils.fs.createWriteStream(`${filename}-${i}.json`)
      }

      let sep = '['
      for (let i = 0; i < maxRows; i += 1000) {
        const { [Authors.name]: batch } = await data.asJson({ [Authors.name]: [] }, cds.model, 1000)
        batch.forEach((r, x) => r.ID = i + x)
        for (const f in files) {
          const fd = files[f]
          if (!fd) continue
          fd.write(sep) // write [ and ,
          const str = JSON.stringify(batch.slice(0, f - i)).slice(1, -1) // remove [ and ]
          fd.write(str)
          if (f <= i + batch.length) {
            fd.end(']')
            files[f] = null
          }
        }
        sep = ','
      }
      Authors.elements.books = books
    }

    async function measure(name, rows, cb) {
      await cds.ql.DELETE.from(Authors)

      const s = {
        time: performance.now(),
        cpu: process.cpuUsage(),
      }
      await cb()
      const a = {
        time: performance.now(),
        cpu: process.cpuUsage(),
      }
      const sys = (a.cpu.system - s.cpu.system)
      const user = (a.cpu.user - s.cpu.user)
      console.log(`${name.padStart(15)} (${rows.toString().padStart(maxRows.toString().length)})`,
        ((a.time - s.time) >>> 0).toString().padStart(6), 'ms',
        'cpu:', (((user / (user + sys)) * 100) >>> 0).toString().padStart(3), '%')
    }

    // streaming
    for (const i in files) {
      await measure('streaming', i, async () => cds.ql.INSERT(cds.utils.fs.createReadStream(`${filename}-${i}.json`)).into(Authors))
    }

    // entries
    for (const i in files) {
      const entries = require(`${filename}-${i}.json`)
      await measure('entries', i, async () => cds.ql.INSERT(entries).into(Authors))
    }

    // native
    delete files[1e6]
    for (const i in files) {
      const entries = require(`${filename}-${i}.json`)
      await measure('native', i, async () => cds.ql.INSERT(entries).into(`${Authors}`))
    }

  })

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
