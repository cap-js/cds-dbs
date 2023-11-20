const cds = require('../../../test/cds.js')
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

    test('READ stream property using SELECT CQN', async () => {
      const { Images } = cds.entities('test')
      const cqn = SELECT('data').from(Images,1)
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
        [4, null, null]
      ])
    })

    afterAll(async () => {
      const { Images } = cds.entities('test')
      await DELETE.from(Images)
    })

    // REVISIT: Add test for error while reading stream OR test manually

    describe('READ', () => {
      test('READ stream property with .one .from, .column and .where', async () => {
        const { Images } = cds.entities('test')
        const { data: stream } = await SELECT.one.from(Images).columns('data').where({ ID: 1 })
        await checkSize(stream)
      })

      test('READ stream property with .from, .column and .where', async () => {
        const { Images } = cds.entities('test')
        const [{ data: stream }] = await SELECT.from(Images).columns('data').where({ ID: 1 })
        await checkSize(stream)
      })

      test('READ null stream property with .from, .column and .where', async () => {
        const { Images } = cds.entities('test')
        const [{ data: stream }] = await SELECT.from(Images).columns('data').where({ ID: 2 })
        expect(stream).toBeNull()
      })
      
      test('READ ID and stream property with .from, .column and .where', async () => {
        const { Images } = cds.entities('test')
        const [{ ID, data: stream }] = await SELECT.from(Images).columns(['ID', 'data']).where({ ID: 1 })
        await checkSize(stream)
        expect(ID).toEqual(1)
      })

      test('READ multiple stream properties with .from, .column and .where', async () => {
        const { Images } = cds.entities('test')
        const [{ ID, data: stream1, data2: stream2 }] = await SELECT.from(Images).columns(['ID', 'data', 'data2']).where({ ID: 1 })
        await checkSize(stream1)
        await checkSize(stream2)
        expect(ID).toEqual(1)
      })

      test('READ all entries with stream property with .from, .column ', async () => {
        const { Images } = cds.entities('test')
        const [{ ID: ID1, data: stream1, data2: stream2 }, { ID: ID2, data: stream3, data2: stream4 }, { ID: ID3, data: stream5, data2: stream6 }] = await SELECT.from(Images).columns(['ID', 'data', 'data2'])
        await checkSize(stream1)
        await checkSize(stream2)        
        expect(stream3).toBeNull()
        await checkSize(stream4)
        await checkSize(stream5)        
        expect(stream6).toBeNull()
        expect(ID1).toEqual(1)
        expect(ID2).toEqual(2)
        expect(ID3).toEqual(3)        
      })

      test('READ one ignore stream properties if columns = all', async () => {
        const { Images } = cds.entities('test')
        const result = await SELECT.from(Images).where({ ID: 1 })
        expect(result[0].ID).toBe(1)
        expect(result[0].data).toBeUndefined()
        expect(result[0].data2).toBeUndefined()
      })

      test('READ multiple entries ignore stream properties if columns = all', async () => {
        const { Images } = cds.entities('test')
        const result = await SELECT.from(Images)
        expect(result[0].ID).toBe(1)
        expect(result[0].data).toBeUndefined()
        expect(result[0].data2).toBeUndefined()
        expect(result[1].ID).toBe(2)
        expect(result[1].data).toBeUndefined()
        expect(result[1].data2).toBeUndefined()
      })

      test('READ ignore stream properties if columns = *', async () => {
        const { Images } = cds.entities('test')
        const result = await SELECT.from(Images).columns('*').where({ ID: 1 })
        expect(result[0].ID).toBe(1)
        expect(result[0].data).toBeUndefined()
        expect(result[0].data2).toBeUndefined()
      })

      test('READ all properties from not existing entry', async () => {
        const { Images } = cds.entities('test')
        const res = await SELECT.from(Images).columns('*').where({ ID: 15 })
        expect(res.length).toBe(0)
      })

      test('READ stream property from not existing entry', async () => {
        const { Images } = cds.entities('test')
        const res = await SELECT.from(Images).columns('data').where({ ID: 15 })
        expect(res.length).toBe(0)
      })
    })

    describe('compat READ', () => {
      beforeAll(async () => {
        cds.env.features.compat_stream_cqn = true
      })

      afterAll(async () => {
        cds.env.features.compat_stream_cqn = false
      })      

      test('READ stream property with _streaming = true', async () => {
        const { Images } = cds.entities('test')
        const cqn = SELECT.one.from(Images).columns('data').where({ ID: 1 })
        cqn._streaming = true
        const { value: stream } = await cqn
        await checkSize(stream)
      })

      test('READ stream property w/o _streaming = true', async () => {
        const { Images } = cds.entities('test')
        const { data: buffer } = await SELECT.one.from(Images).columns('data').where({ ID: 1 })
        expect(buffer.length).toBe(10524)
      })

      test('READ multiple stream properties with _streaming = true', async () => {
        const { Images } = cds.entities('test')
        const cqn = SELECT.from(Images).columns(['data', 'data2']).where({ ID: 1 })
        cqn._streaming = true
        const { value: stream } = await cqn
        await checkSize(stream)
      })

      test('RREAD multiple stream properties w/o _streaming = true', async () => {
        const { Images } = cds.entities('test')
        const [{ data: buffer1, ID, data2: buffer2 }] = await SELECT.from(Images).columns(['data', 'ID', 'data2']).where({ ID: 1 })
        expect(ID).toBe(1)
        expect(buffer1.length).toBe(10524)
        expect(buffer2.length).toBe(10524)
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

      // TODO: Separate entities (also for cds.stream()) !!!!!
      // Add clean-up for test_Images

      test('WRITE stream property', async () => {
        const { Images } = cds.entities('test')
        const stream = fs.createReadStream(path.join(__dirname, 'samples/test.jpg'))

        const changes = await UPDATE(Images).with({ data2: stream }).where({ ID: 3 })
        expect(changes).toEqual(1)
        
        const [{ data2: stream_ }] = await SELECT.from(Images).columns('data2').where({ ID: 3 })
        await checkSize(stream_)
      }) 
      
      test('WRITE multiple stream properties', async () => {
        const { Images } = cds.entities('test')
        const stream1 = fs.createReadStream(path.join(__dirname, 'samples/test.jpg'))
        const stream2 = fs.createReadStream(path.join(__dirname, 'samples/test.jpg'))

        const changes = await UPDATE(Images).with({ data: stream1, data2: stream2 }).where({ ID: 4 })
        expect(changes).toEqual(1)
        
        const [{ data: stream1_, data2: stream2_ }] = await SELECT.from(Images).columns(['data','data2']).where({ ID: 4 })
        await checkSize(stream1_)
        await checkSize(stream2_)
      }) 

      test('WRITE multiple blob properties', async () => {
        const { Images } = cds.entities('test')
        const blob1 = fs.readFileSync(path.join(__dirname, 'samples/test.jpg'))
        const blob2 = fs.readFileSync(path.join(__dirname, 'samples/test.jpg'))
        
        const changes = await UPDATE(Images).with({ data: blob1, data2: blob2 }).where({ ID: 4 })
        expect(changes).toEqual(1)
        
        const [{ data: stream1_, data2: stream2_ }] = await SELECT.from(Images).columns(['data','data2']).where({ ID: 4 })
        await checkSize(stream1_)
        await checkSize(stream2_)
      }) 

      test('WRITE stream property on view', async () => {
        const { ImagesView } = cds.entities('test')
        const stream = fs.createReadStream(path.join(__dirname, 'samples/test.jpg'))

        const changes = await UPDATE(ImagesView).with({ renamedData: stream }).where({ ID: 1 })
        expect(changes).toEqual(1)

        const [{ renamedData: stream_ }] = await SELECT.from(ImagesView).columns('renamedData').where({ ID: 1 })
        await checkSize(stream_)
      })
      
      test('WRITE dataset from json file stream', async () => {
        const { Images } = cds.entities('test')

        // to be discussed
        // const stream = fs.createReadStream(path.join(__dirname, 'samples/data.json'))
        // const changes = await STREAM.into(Images).data(stream)

        const json = JSON.parse(fs.readFileSync(path.join(__dirname, 'samples/data.json')))
        const changes = await INSERT.into(Images).entries(json)

        try {
          expect(changes).toEqual(2)
        } catch (e) {
          // @sap/hana-client does not allow for returning the number of affected rows
        }

        const out1000 = fs.createWriteStream(path.join(__dirname, 'samples/1000.png'))
        const out1001 = fs.createWriteStream(path.join(__dirname, 'samples/1001.png'))

        const in1000 = await SELECT.one.from(Images, { ID: 1000 }).columns(['data'])
        const in1001 = await SELECT.one.from(Images, { ID: 1001 }).columns(['data'])

        in1000.data.pipe(out1000)
        in1001.data.pipe(out1001)

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

        const changes = await INSERT.into(Images).entries({ data: stream })
        try {
          expect(changes).toEqual(count)
        } catch (e) {
          // @sap/hana-client does not allow for returning the number of affected rows
        }
      })
    })
  })
})
