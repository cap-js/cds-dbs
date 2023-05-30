const cds = require('../../../test/cds.js')
const { fs, path } = cds.utils
const { Readable } = require('stream')

cds.test(__dirname, 'model.cds')

const readStream = (id, done) => {
  const { Images } = cds.entities('test')
  const file = path.join(__dirname, 'samples/out.jpg')
  STREAM.from(Images, { ID: id })
    .column('data')
    .then(stream =>
      stream.pipe(
        fs.createWriteStream(file).once('finish', () => {
          expect(fs.statSync(file).size).toEqual(7891)
          fs.unlink(file, done)
        }),
      ),
    )
}

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

  test('READ stream property with .from and .where', done => {
    const { Images } = cds.entities('test')
    const file = path.join(__dirname, 'samples/out.jpg')

    cds
      .stream('data')
      .from(Images)
      .where({ ID: 1 })
      .then(stream =>
        stream.pipe(
          fs.createWriteStream(file).once('finish', () => {
            expect(fs.statSync(file).size).toEqual(7891)
            fs.unlink(file, done)
          }),
        ),
      )
  })

  test('READ stream property that equals null', async () => {
    const { Images } = cds.entities('test')
    const stream = await cds.stream('data').from(Images).where({ ID: 2 })
    expect(stream).toBeNull()
  })

  test('READ stream property with object in .from', done => {
    const { Images } = cds.entities('test')
    const file = path.join(__dirname, 'samples/out.jpg')

    cds
      .stream('data')
      .from(Images, { ID: 1 })
      .then(stream =>
        stream.pipe(
          fs.createWriteStream(file).once('finish', () => {
            expect(fs.statSync(file).size).toEqual(7891)
            fs.unlink(file, done)
          }),
        ),
      )
  })

  test('READ stream property with key in .from', done => {
    const { Images } = cds.entities('test')
    const file = path.join(__dirname, 'samples/out.jpg')

    cds
      .stream('data')
      .from(Images, 1)
      .then(stream =>
        stream.pipe(
          fs.createWriteStream(file).once('finish', () => {
            expect(fs.statSync(file).size).toEqual(7891)
            fs.unlink(file, done)
          }),
        ),
      )
  })

  test('READ stream property with .where as alternating string/value arguments list', done => {
    const { Images } = cds.entities('test')
    const file = path.join(__dirname, 'samples/out.jpg')

    cds
      .stream('data')
      .from(Images)
      .where('ID =', 1)
      .then(stream =>
        stream.pipe(
          fs.createWriteStream(file).once('finish', () => {
            expect(fs.statSync(file).size).toEqual(7891)
            fs.unlink(file, done)
          }),
        ),
      )
  })

  test('READ stream property from entry that does not exist', async () => {
    const { Images } = cds.entities('test')
    try {
      await cds.stream('data').from(Images, 23)
    } catch (e) {
      expect(e.message).toEqual('Entity "test.Images" with entered keys is not found')
    }
  })

  test('READ stream property with key and column in .from', done => {
    const { Images } = cds.entities('test')
    const file = path.join(__dirname, 'samples/out.jpg')

    cds
      .stream()
      .from(Images, 1, 'data')
      .then(stream =>
        stream.pipe(
          fs.createWriteStream(file).once('finish', () => {
            expect(fs.statSync(file).size).toEqual(7891)
            fs.unlink(file, done)
          }),
        ),
      )
  })

  test('READ stream property with column as function in .from', done => {
    const { Images } = cds.entities('test')
    const file = path.join(__dirname, 'samples/out.jpg')

    cds
      .stream()
      .from(Images, 1, a => a.data)
      .then(stream =>
        stream.pipe(
          fs.createWriteStream(file).once('finish', () => {
            expect(fs.statSync(file).size).toEqual(7891)
            fs.unlink(file, done)
          }),
        ),
      )
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

  test('READ stream property with .from, .column and .where', done => {
    const { Images } = cds.entities('test')
    const file = path.join(__dirname, 'samples/out.jpg')

    STREAM.from(Images)
      .column('data')
      .where({ ID: 1 })
      .then(stream =>
        stream.pipe(
          fs.createWriteStream(file).once('finish', () => {
            expect(fs.statSync(file).size).toEqual(7891)
            fs.unlink(file, done)
          }),
        ),
      )
  })

  test('READ stream property that equals null with .from, .columns and .where', async () => {
    const { Images } = cds.entities('test')
    const stream = await STREAM.from(Images).column('data').where({ ID: 2 })
    expect(stream).toBeNull()
  })

  test('READ stream property with key as object in .from', done => {
    const { Images } = cds.entities('test')
    const file = path.join(__dirname, 'samples/out.jpg')

    STREAM.from(Images, { ID: 1 })
      .column('data')
      .then(stream =>
        stream.pipe(
          fs.createWriteStream(file).once('finish', () => {
            expect(fs.statSync(file).size).toEqual(7891)
            fs.unlink(file, done)
          }),
        ),
      )
  })

  test('READ stream property with key as value in .from', done => {
    const { Images } = cds.entities('test')
    const file = path.join(__dirname, 'samples/out.jpg')

    STREAM.from(Images, 1)
      .column('data')
      .then(stream =>
        stream.pipe(
          fs.createWriteStream(file).once('finish', () => {
            expect(fs.statSync(file).size).toEqual(7891)
            fs.unlink(file, done)
          }),
        ),
      )
  })

  test('READ stream property with key and column in .from', done => {
    const { Images } = cds.entities('test')
    const file = path.join(__dirname, 'samples/out.jpg')

    STREAM.from(Images, 1, 'data').then(stream =>
      stream.pipe(
        fs.createWriteStream(file).once('finish', () => {
          expect(fs.statSync(file).size).toEqual(7891)
          fs.unlink(file, done)
        }),
      ),
    )
  })

  test('READ stream property with column in STREAM', done => {
    const { Images } = cds.entities('test')
    const file = path.join(__dirname, 'samples/out.jpg')

    STREAM('data')
      .from(Images, 1)
      .then(stream =>
        stream.pipe(
          fs.createWriteStream(file).once('finish', () => {
            expect(fs.statSync(file).size).toEqual(7891)
            fs.unlink(file, done)
          }),
        ),
      )
  })

  test('READ stream property from not existing entry', async () => {
    const { Images } = cds.entities('test')
    try {
      await STREAM('data').from(Images, 15)
    } catch (e) {
      expect(e.message).toEqual('Entity "test.Images" with entered keys is not found')
    }
  })

  test('READ stream property without .where', done => {
    const { Images } = cds.entities('test')
    const file = path.join(__dirname, 'samples/out.jpg')
    // with no where condition implicit limit(1) is set
    STREAM('data')
      .from(Images)
      .then(stream =>
        stream.pipe(
          fs.createWriteStream(file).once('finish', () => {
            expect(fs.statSync(file).size).toEqual(7891)
            fs.unlink(file, done)
          }),
        ),
      )
  })

  test('WRITE with incorrect data type results in error', async () => {
    const { Images } = cds.entities('test')
    const val = fs.readFileSync(path.join(__dirname, 'samples/test.jpg'))

    const stream = new Readable()
    stream.push(val)
    // data should be a stream
    stream.push(1)
    stream.push(null)
    try {
      await STREAM.into(Images).column('data').data(stream).where({ ID: 1 })
    } catch (err) {
      expect(err.code).toEqual('ERR_INVALID_ARG_TYPE')
    }
  })

  test('WRITE stream property with .column and .where', done => {
    const { Images } = cds.entities('test')
    const stream = fs.createReadStream(path.join(__dirname, 'samples/test.jpg'))

    STREAM.into(Images)
      .column('data')
      .data(stream)
      .where({ ID: 1 })
      .then(async rowNum => {
        expect(rowNum).toEqual(1)
        readStream(1, done)
      })
  })

  test('WRITE stream property with keys as object in .into', done => {
    const { Images } = cds.entities('test')
    const stream = fs.createReadStream(path.join(__dirname, 'samples/test.jpg'))

    STREAM.into(Images, { ID: 1 })
      .column('data')
      .data(stream)
      .then(async rowNum => {
        expect(rowNum).toEqual(1)
        readStream(1, done)
      })
  })

  test('WRITE stream property with keys as integer in .into', done => {
    const { Images } = cds.entities('test')
    const stream = fs.createReadStream(path.join(__dirname, 'samples/test.jpg'))

    STREAM.into(Images, 1)
      .column('data')
      .data(stream)
      .then(async rowNum => {
        expect(rowNum).toEqual(1)
        readStream(1, done)
      })
  })

  xtest('WRITE stream property with keys and column in .into', done => {
    const { Images } = cds.entities('test')
    const stream = fs.createReadStream(path.join(__dirname, 'samples/test.jpg'))

    STREAM.into(Images, 1, 'data')
      .data(stream)
      .then(async rowNum => {
        expect(rowNum).toEqual(1)
        readStream(1, done)
      })
  })

  xtest('WRITE stream property with data in STREAM', done => {
    const { Images } = cds.entities('test')
    const stream = fs.createReadStream(path.join(__dirname, 'samples/test.jpg'))

    STREAM(stream)
      .into(Images, 1, 'data')
      .then(async rowNum => {
        expect(rowNum).toEqual(1)
        readStream(1, done)
      })
  })
})
