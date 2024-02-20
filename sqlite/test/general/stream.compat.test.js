const cds = require('../../../test/cds.js')
process.env.CDS_CONFIG = JSON.stringify({ features : { stream_compat: true } })

const { fs, path } = cds.utils
const { Readable } = require('stream')

const checkSize = async stream => {
  let size = 0
  for await (const chunk of stream) {
    size += chunk.length
  }
  expect(size).toEqual(7891)
}

describe('streaming', () => {
  cds.test(__dirname, 'model.cds')
  describe('cds.stream', () => {
    beforeAll(async () => {
      const data = fs.readFileSync(path.join(__dirname, 'samples/test.jpg'))
      await cds.run('INSERT INTO test_Images values(?,?,?)', [
        [1, data, null],
        [2, null, null],
      ])
    })

    afterAll(async () => {
      const { Images } = cds.entities('test')
      await DELETE.from(Images)
    })

    test('READ stream property with .from and .where', async () => {
      const { Images } = cds.entities('test')
      const cqn = cds.stream('data').from(Images).where({ ID: 1 })
      const stream = await cqn
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

    test('READ stream property using SELECT CQN', async () => {
      const { Images } = cds.entities('test')
      const cqn = SELECT('data').from(Images, 1)
      const stream = await cds.stream(cqn)
      await checkSize(stream)
    })
  })

  describe('Streaming API', () => {
    beforeAll(async () => {
      const data = fs.readFileSync(path.join(__dirname, 'samples/test.jpg'))
      await cds.run('INSERT INTO test_Images values(?,?,?)', [
        [1, data, data],
        [2, null, data],
        [3, data, null],
        [4, null, null],
      ])
    })

    afterAll(async () => {
      const { Images } = cds.entities('test')
      await DELETE.from(Images)
    })

    describe('READ', () => {
      test('READ stream property with _streaming = true', async () => {
        const { Images } = cds.entities('test')
        const cqn = SELECT.one.from(Images).columns('data').where({ ID: 1 })
        cqn._streaming = true
        const { value: stream } = await cqn
        await checkSize(stream)
      })

      test('READ stream property w/o _streaming = true', async () => {
        const { Images } = cds.entities('test')
        const { data: str } = await SELECT.one.from(Images).columns('data').where({ ID: 1 })
        const buffer = Buffer.from(str, 'base64')
        expect(buffer.length).toBe(7891)
      })

      test('READ multiple stream properties with _streaming = true', async () => {
        const { Images } = cds.entities('test')
        const cqn = SELECT.from(Images).columns(['data', 'data2']).where({ ID: 1 })
        cqn._streaming = true
        const { value: stream } = await cqn
        await checkSize(stream)
      })

      test('READ multiple stream properties w/o _streaming = true', async () => {
        const { Images } = cds.entities('test')
        const [{ data: str1, ID, data2: str2 }] = await SELECT.from(Images)
          .columns(['data', 'ID', 'data2'])
          .where({ ID: 1 })
        expect(ID).toBe(1)
        const buffer1 = Buffer.from(str1, 'base64')
        expect(buffer1.length).toBe(7891)
        const buffer2 = Buffer.from(str2, 'base64')
        expect(buffer2.length).toBe(7891)
      })

      test('READ null stream property', async () => {
        const { Images } = cds.entities('test')
        const cqn = SELECT.from(Images).columns('data').where({ ID: 2 })
        cqn._streaming = true
        const { value: stream } = await cqn
        expect(stream).toBeNull()
      })

      test('READ null stream property', async () => {
        const { Images } = cds.entities('test')
        const [{ data: stream }] = await SELECT.from(Images).columns('data').where({ ID: 2 })
        expect(stream).toBeNull()
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
          await UPDATE(Images).with({ data: stream }).where({ ID: 1 })
          expect(1).toBe(2)
        } catch (err) {
          expect(err.code).toEqual('ERR_INVALID_ARG_TYPE')
        }
      })

      test('WRITE single stream property', async () => {
        const { Images } = cds.entities('test')
        const stream = fs.createReadStream(path.join(__dirname, 'samples/test.jpg'))

        const changes = await UPDATE(Images).with({ data2: stream }).where({ ID: 3 })
        expect(changes).toEqual(1)

        const cqn = SELECT.from(Images).columns('data2').where({ ID: 3 })
        cqn._streaming = true
        const { value: stream_ } = await cqn
        await checkSize(stream_)
      })

      test('WRITE multiple stream properties', async () => {
        const { Images } = cds.entities('test')
        const stream1 = fs.createReadStream(path.join(__dirname, 'samples/test.jpg'))
        const stream2 = fs.createReadStream(path.join(__dirname, 'samples/test.jpg'))

        const changes = await UPDATE(Images).with({ data: stream1, data2: stream2 }).where({ ID: 4 })
        expect(changes).toEqual(1)

        const cqn = SELECT.from(Images).columns(['data', 'data2']).where({ ID: 4 })
        const [{ data: str1, data2: str2 }] = await cqn
        const buffer1 = Buffer.from(str1, 'base64')
        expect(buffer1.length).toBe(7891)
        const buffer2 = Buffer.from(str2, 'base64')
        expect(buffer2.length).toBe(7891)
      })

      test('WRITE multiple blob properties', async () => {
        const { Images } = cds.entities('test')
        const blob1 = fs.readFileSync(path.join(__dirname, 'samples/test.jpg'))
        const blob2 = fs.readFileSync(path.join(__dirname, 'samples/test.jpg'))

        const changes = await UPDATE(Images).with({ data: blob1, data2: blob2 }).where({ ID: 4 })
        expect(changes).toEqual(1)

        const cqn = SELECT.from(Images).columns(['data', 'data2']).where({ ID: 4 })
        const [{ data: str1, data2: str2 }] = await cqn
        const buffer1 = Buffer.from(str1, 'base64')
        expect(buffer1.length).toBe(7891)
        const buffer2 = Buffer.from(str2, 'base64')
        expect(buffer2.length).toBe(7891)
      })

      test('WRITE stream property on view', async () => {
        const { ImagesView } = cds.entities('test')
        const stream = fs.createReadStream(path.join(__dirname, 'samples/test.jpg'))

        const changes = await UPDATE(ImagesView).with({ renamedData: stream }).where({ ID: 1 })
        expect(changes).toEqual(1)

        const cqn = SELECT.from(ImagesView).columns('renamedData').where({ ID: 1 })
        cqn._streaming = true
        const { value: stream_ } = await cqn
        await checkSize(stream_)
      })

      test('WRITE dataset from json file stream', async () => {
        const { Images } = cds.entities('test')

        // REVISIT: required proper BASE64_DECODE support from HANA
        // const stream = fs.createReadStream(path.join(__dirname, 'samples/data.json'))
        // const changes = await INSERT(stream).into(Images)

        const json = JSON.parse(fs.readFileSync(path.join(__dirname, 'samples/data.json')))
        const changes = await INSERT.into(Images).entries(json)

        try {
          expect(changes).toEqual(2)
        } catch (e) {
          // @sap/hana-client does not allow for returning the number of affected rows
        }

        const out1000 = fs.createWriteStream(path.join(__dirname, 'samples/1000.png'))
        const out1001 = fs.createWriteStream(path.join(__dirname, 'samples/1001.png'))

        const cqn1 = SELECT.one.from(Images, { ID: 1000 }).columns(['data'])
        const cqn2 = SELECT.one.from(Images, { ID: 1001 }).columns(['data'])
        cqn1._streaming = true
        cqn2._streaming = true
        const in1000 = await cqn1
        const in1001 = await cqn2

        in1000.value.pipe(out1000)
        in1001.value.pipe(out1001)

        const wrap = stream =>
          new Promise((resolve, reject) => {
            stream.on('finish', resolve)
            stream.on('error', reject)
          })

        await Promise.all([wrap(out1000), wrap(out1001)])
      })

      // TODO: breaks on Postgres, because INSERT tries to decode it as base64 string (InputConverters)
      xtest('WRITE dataset from json generator stream', async () => {
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
        const stream = Readable.from(generator(), { objectMode: false })

        const changes = await INSERT.into(Images).entries(stream)
        try {
          expect(changes).toEqual(count)
        } catch (e) {
          // @sap/hana-client does not allow for returning the number of affected rows
        }
      })
    })
  })
})
