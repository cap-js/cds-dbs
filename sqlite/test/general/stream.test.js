const cds = require('../../../test/cds.js')
const { fs, path } = cds.utils
const { Readable } = require('stream')
const { json: streamJson } = require('stream/consumers')

const checkSize = async stream => {
  let size = 0
  for await (const chunk of stream) {
    size += chunk.length
  }
  expect(size).toEqual(7891)
}

const readStream = async (id, entity = cds.entities('test').Images) => {
  const stream = await STREAM.from(entity, { ID: id }).column('data')
  await checkSize(stream)
}

describe('STREAM', () => {
  cds.test(__dirname, 'model.cds')

  describe('cds.stream', () => {
    beforeAll(async () => {
      const data = fs.readFileSync(path.join(__dirname, 'samples/test.jpg'))
      await cds.run('INSERT INTO test_Images values(?,?)', [
        [1, data],
        [2, null],
      ])
    })

    afterAll(async () => {
      const { Images } = cds.entities('test')
      await DELETE.from(Images)
    })

    test('READ stream property with .from and .where', async () => {
      const { Images } = cds.entities('test')
      const stream = await cds.stream('data').from(Images).where({ ID: 1 })
      await checkSize(stream)
    })

    test('READ stream property that equals null', async () => {
      const { Images } = cds.entities('test')
      const stream = await cds.stream('data').from(Images).where({ ID: 2 })
      expect(stream).toBeNull()
    })

    test('READ stream property with object in .from', async () => {
      const { Images } = cds.entities('test')
      const stream = await cds.stream('data').from(Images, { ID: 1 })
      await checkSize(stream)
    })

    test('READ stream property with key in .from', async () => {
      const { Images } = cds.entities('test')
      const stream = await cds.stream('data').from(Images, 1)
      await checkSize(stream)
    })

    test('READ stream property with .where as alternating string/value arguments list', async () => {
      const { Images } = cds.entities('test')
      const stream = await cds.stream('data').from(Images).where('ID =', 1)
      await checkSize(stream)
    })

    test('READ stream property from entry that does not exist', async () => {
      const { Images } = cds.entities('test')
      try {
        await cds.stream('data').from(Images, 23)
      } catch (e) {
        expect(e.code).toEqual(404)
      }
    })

    test('READ stream property with key and column in .from', async () => {
      const { Images } = cds.entities('test')
      const stream = await cds.stream().from(Images, 1, 'data')
      await checkSize(stream)
    })

    test('READ stream property with column as function in .from', async () => {
      const { Images } = cds.entities('test')
      const stream = await cds.stream().from(Images, 1, a => a.data)
      await checkSize(stream)
    })
  })

  describe('new STREAM API', () => {
    beforeAll(async () => {
      const data = fs.readFileSync(path.join(__dirname, 'samples/test.jpg'))
      await cds.run('INSERT INTO test_Images values(?,?)', [
        [1, data],
        [2, null],
        [3, data],
      ])
    })

    afterAll(async () => {
      const { Images } = cds.entities('test')
      await DELETE.from(Images)
    })

    describe('READ', () => {
      test('READ stream property with .from, .column and .where', async () => {
        const { Images } = cds.entities('test')
        const stream = await STREAM.from(Images).column('data').where({ ID: 1 })
        await checkSize(stream)
      })

      test('READ stream property that equals null with .from, .columns and .where', async () => {
        const { Images } = cds.entities('test')
        const stream = await STREAM.from(Images).column('data').where({ ID: 2 })
        expect(stream).toBeNull()
      })

      test('READ stream property with key as object in .from', async () => {
        const { Images } = cds.entities('test')
        const stream = await STREAM.from(Images, { ID: 1 }).column('data')
        await checkSize(stream)
      })

      test('READ stream property with key as value in .from', async () => {
        const { Images } = cds.entities('test')
        const stream = await STREAM.from(Images, 1).column('data')
        await checkSize(stream)
      })

      test('READ stream property with key and column in .from', async () => {
        const { Images } = cds.entities('test')
        const stream = await STREAM.from(Images, 1, 'data')
        await checkSize(stream)
      })

      test('READ stream property with column in STREAM', async () => {
        const { Images } = cds.entities('test')
        const stream = await STREAM('data').from(Images, 1)
        await checkSize(stream)
      })

      test('READ stream property from not existing entry', async () => {
        const { Images } = cds.entities('test')
        try {
          await STREAM('data').from(Images, 15)
        } catch (e) {
          expect(e.code).toEqual(404)
        }
      })

      test('READ stream property without .where', async () => {
        const { Images } = cds.entities('test')
        // with no where condition implicit limit(1) is set
        const stream = await STREAM('data').from(Images)
        await checkSize(stream)
      })

      test('READ stream dataset from entity', async () => {
        const { Images } = cds.entities('test')
        await cds.tx(async () => {
          const stream = await STREAM.from(Images)
          const result = await streamJson(stream)
          expect(result.length).toEqual(3)
        })
      })

      test('READ stream dataset from entity with LargeBinary columns', async () => {
        const { Images } = cds.entities('test')
        await cds.tx(async () => {
          const select = SELECT(['ID', 'data']).from(Images)
          const stream = await STREAM(['ID', 'data']).from(select)
          const result = await streamJson(stream)

          expect(result.length).toEqual(3)

          // Decode LargeBinary columns from base64
          expect(Buffer.from(result[0].data, 'base64').length).toEqual(7891)
          expect(result[1].data).toEqual(null)
          expect(Buffer.from(result[2].data, 'base64').length).toEqual(7891)
        })
      })
    })

    describe('WRITE', () => {
      test('WRITE with incorrect data type results in error', async () => {
        const { Images } = cds.entities('test')

        const stream = new Readable({
          read() {
            // Push invalid data onto stream to simulate an error
            this.push(1)
          },
        })
        try {
          await STREAM.into(Images).column('data').data(stream).where({ ID: 1 })
        } catch (err) {
          expect(err.code).toEqual('ERR_INVALID_ARG_TYPE')
        }
      })

      test('WRITE stream property with .column and .where', async () => {
        const { Images } = cds.entities('test')
        const stream = fs.createReadStream(path.join(__dirname, 'samples/test.jpg'))

        const changes = await STREAM.into(Images).column('data').data(stream).where({ ID: 1 })
        expect(changes).toEqual(1)
        await readStream(1)
      })

      test('WRITE stream property with keys as object in .into', async () => {
        const { Images } = cds.entities('test')
        const stream = fs.createReadStream(path.join(__dirname, 'samples/test.jpg'))

        const changes = await STREAM.into(Images, { ID: 1 }).column('data').data(stream)
        expect(changes).toEqual(1)
        await readStream(1)
      })

      test('WRITE stream property with keys as integer in .into', async () => {
        const { Images } = cds.entities('test')
        const stream = fs.createReadStream(path.join(__dirname, 'samples/test.jpg'))

        const changes = await STREAM.into(Images, 1).column('data').data(stream)
        expect(changes).toEqual(1)
        await readStream(1)
      })

      test('WRITE stream property on view', async () => {
        const { ImagesView } = cds.entities('test')
        const stream = fs.createReadStream(path.join(__dirname, 'samples/test.jpg'))

        const changes = await STREAM.into(ImagesView, 1).column('renamedData').data(stream)
        expect(changes).toEqual(1)
        await readStream(1, ImagesView)
      })

      test('WRITE dataset from json file stream', async () => {
        const { Images } = cds.entities('test')
        const stream = fs.createReadStream(path.join(__dirname, 'samples/data.json'))

        const changes = await STREAM.into(Images).data(stream)
        try {
          expect(changes).toEqual(2)
        } catch (e) {
          // @sap/hana-client does not allow for returning the number of affected rows
        }

        const out1000 = fs.createWriteStream(path.join(__dirname, 'samples/1000.png'))
        const out1001 = fs.createWriteStream(path.join(__dirname, 'samples/1001.png'))

        const in1000 = await STREAM.from(Images, { ID: 1000 }).column('data')
        const in1001 = await STREAM.from(Images, { ID: 1001 }).column('data')

        in1000.pipe(out1000)
        in1001.pipe(out1001)

        const wrap = stream =>
          new Promise((resolve, reject) => {
            stream.on('finish', resolve)
            stream.on('error', reject)
          })

        await Promise.all([wrap(out1000), wrap(out1001)])
      })

      test('WRITE dataset from json generator stream', async () => {
        const { Images } = cds.entities('test')

        const start = 2000
        const count = 1000

        const generator = function* () {
          let i = start
          const end = start + count
          yield '['
          yield `{"ID":${i++}}` // yield once before the loop to skip the comma
          while (i < end) {
            yield `,{"ID":${i++}}`
          }
          yield ']'
        }
        const stream = Readable.from(generator())

        const changes = await STREAM.into(Images).data(stream)
        try {
          expect(changes).toEqual(count)
        } catch (e) {
          // @sap/hana-client does not allow for returning the number of affected rows
        }
      })
    })
  })
})
