const cds = require('../cds')

const { Readable } = require('stream')

describe('INSERT', () => {
  const { data, expect } = cds.test(__dirname + '/resources')
  data.autoIsolation(true)
  data.autoReset()

  describe('into', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  describe('entries', () => {
    const genCount = 100
    const gen = function* () {
      for (let i = 0; i < genCount; i++)
        yield { uuid: cds.utils.uuid() }
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

  describe('as', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
})
