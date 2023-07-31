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

const readStream = async id => {
  const { Images } = cds.entities('test')
  const stream = await STREAM.from(Images, { ID: id }).column('data')
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

    xtest('WRITE stream property with keys and column in .into', async () => {
      const { Images } = cds.entities('test')
      const stream = fs.createReadStream(path.join(__dirname, 'samples/test.jpg'))

      const changes = await STREAM.into(Images, 1, 'data').data(stream)
      expect(changes).toEqual(1)
      await readStream(1)
    })

    xtest('WRITE stream property with data in STREAM', async () => {
      const { Images } = cds.entities('test')
      const stream = fs.createReadStream(path.join(__dirname, 'samples/test.jpg'))

      const changes = await STREAM(stream).into(Images, 1, 'data')
      expect(changes).toEqual(1)
      await readStream(1)
    })
  })
})
