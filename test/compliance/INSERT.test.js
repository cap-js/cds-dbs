const cds = require('../cds')
const { text } = require('stream/consumers')
const { PassThrough, Readable } = require('stream')

describe('INSERT', () => {
  const { expect } = cds.test(__dirname + '/resources')

  describe('into', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  describe('entries', () => {
    let genCount = 0
    const gen = function* () {
      for (var i = 0; i < 100; i++)
        yield { uuid: cds.utils.uuid() }
      genCount += i
    }

    test('array', async () => {
      const { uuid } = cds.entities('basic.literals')

      await INSERT([...gen()]).into(uuid)

      const result = await SELECT.from(uuid)
      expect(result.length).to.eq(genCount)
    })

    test('iterator', async () => {
      const { uuid } = cds.entities('basic.literals')

      await INSERT(gen()).into(uuid)

      const result = await SELECT.from(uuid)
      expect(result.length).to.eq(genCount)
    })

    test('Readable (Object Mode)', async () => {
      const { uuid } = cds.entities('basic.literals')

      await INSERT(Readable.from(gen())).into(uuid)

      const result = await SELECT.from(uuid)
      expect(result.length).to.eq(genCount)
    })

    test('Readable (Raw Mode)', async () => {
      const { uuid } = cds.entities('basic.literals')

      const raw = function* (src) {
        yield '['
        let sep = ''
        for (const obj of src) {
          yield sep
          yield JSON.stringify(obj)
          sep = ','
        }
        yield ']'
      }

      await INSERT(Readable.from(raw(gen()), { objectMode: false })).into(uuid)

      const result = await SELECT.from(uuid)
      expect(result.length).to.eq(genCount)
    })

    // Example on how to implement a tar upload to database upload endpoint
    test.skip('file stream', async () => {
      const tar = cds.utils.tar
      const { binaries } = cds.entities('basic.literals')

      const pass = new PassThrough()              // Required as tar.c().to() is not allowed
      tar.c(__dirname).to(pass)                   // Create tar stream from file system
      const [a, b] = Readable.toWeb(pass).tee()   // Split tar stream into two parrallel streams
      const t = tar.t(Readable.from(a), '-v')     // Extract tar file paths and sizes
      const x = tar.x(Readable.from(b), '-O').to() // Extract tar file contents to stdout

      // Combine both meta and data streams back into an object entries stream
      const gen = async function* () {
        const data = x.stdout[Symbol.asyncIterator]()
        for await (const chunk of t.stdout) {
          const lines = `${chunk}`.split('\n')
          for (const line of lines) {
            if (!line) continue // Skip empty lines
            const split = / (\d*) \d{4}-\d{2}-\d{2} \d{2}:\d{2} (.*)/.exec(line)
            // TODO: merge left over lines into next chunk
            const [, bytes, path] = split

            if (bytes === '0') continue           // folders don't have bytes sizes
            yield {
              binary: Buffer.from(path),          // Store file path into binary column
              largebinary:                        // Store file contents inside largebinary column
                Readable.from(
                  (async function* (bytes) {
                    bytes = Number.parseInt(bytes)
                    while (bytes) {               // Chunk file content stream into individual file streams
                      const { done, value } = await data.next()
                      if (done) break
                      if (value.length < bytes) {
                        bytes -= value.bytes
                        yield value
                      } else {
                        const ret = value.subarray(0, bytes)
                        bytes -= ret.length
                        x.stdout.unshift(value.subarray(bytes))
                        yield ret
                      }
                    }
                  })(bytes),
                  { objectMode: false }
                )
            }
          }
        }
      }

      await INSERT(Readable.from(gen())).into(binaries)
      const files = await SELECT`binary as path, largebinary as content`.from(binaries)
      for (const file of files) {
        file.path = file.path + ''
        file.content = await text(file.content)
      }
    })

    test('smart quoting', async () => {
      const { Order } = cds.entities('complex.keywords')
      const data = {
        ID: 1,
        alter: [
          {
            ID: 42,
            number: null,
            order_ID: 1,
          },
          {
            ID: 43,
            number: null,
            order_ID: 1,
          },
        ],
      }
      await INSERT(data).into(Order)
      const select = await cds.run(cds.ql`SELECT from ${Order} { ID, alter { * } } where exists alter`)
      expect(select[0]).to.deep.eql(data)
    })
  })

  describe('columns', () => {
    describe('values', () => {
      test.skip('missing', () => {
        throw new Error('not supported')
      })
    })

    describe('rows', () => {
      test.skip('missing', () => {
        throw new Error('not supported')
      })
    })
  })

  describe('from', () => {
    test('smart quoting', async () => {
      const { Alter, ASC } = cds.entities('complex.keywords')
      // fill other table first
      await cds.run(INSERT({ ID: 1, alias: 42 }).into(ASC))
      await INSERT.into(Alter)
        .columns(['ID', 'number'])
        .from(
          SELECT.from(ASC)
            .columns(['ID', 'alias'])
            .where({ ref: ['alias'] }, '=', { val: 42 }),
        )
      const select = await SELECT.from(Alter).where('number = 42')
      expect(select[0]).to.eql({ ID: 1, number: 42, order_ID: null })
    })
  })

  test('InsertResult', async () => {
    const insert = INSERT.into('complex.associations.Books').entries({ ID: 5 })
    const affectedRows = await cds.db.run(insert)
    // affectedRows is an InsertResult, so we need to do lose comparison here, as strict will not work due to InsertResult
    expect(affectedRows == 1).to.be.eq(true)
    // InsertResult
    expect(affectedRows).not.to.include({ _affectedRows: 1 }) // lastInsertRowid not available on postgres
  })

  test('default $now adds current tx timestamp in correct format', async () => {
    await cds.tx(async tx => {
      // the statements are run explicitly in sequential order to ensure current_timestamp would create different timestamps
      await tx.run(INSERT.into('basic.common.dollar_now_default').entries({ id: 5 }))
      await tx.run(INSERT.into('basic.common.dollar_now_default').entries({ id: 6 }))
    })

    const result = await SELECT.from('basic.common.dollar_now_default')
    
    expect(result.length).to.eq(2)
    expect(result[0].date).to.match(/^\d{4}-\d{2}-\d{2}$/)
    expect(result[0].date).to.eq(result[1].date)
    expect(result[0].time).to.match(/^\d{2}:\d{2}:\d{2}$/)
    expect(result[0].time).to.eq(result[1].time)
    expect(result[0].dateTime).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    expect(result[0].dateTime).to.eq(result[1].dateTime)
    expect(result[0].timestamp).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(result[0].timestamp).to.eq(result[1].timestamp)
  })
})
