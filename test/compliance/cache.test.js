const { Readable } = require('stream')

const cds = require('../cds.js')

describe('SQL cache', () => {
  const { expect } = cds.test(__dirname + '/resources')

  describe('SELECT', () => {

    test('static', async () => {
      const { string } = cds.entities('basic.literals')

      const cqn = cds.ql`SELECT FROM ${string}`

      const first = await cqn
      const second = await cds.run(cqn)
      cqn.where`string = ${'yes'}`
      const modified = await cds.run(cqn)
      const modifiedClone = await cds.run(cqn.clone())

      expect(first).length(3)
      expect(second).length(first.length)
      expect(modified.length === first.length || modified.length === modifiedClone.length).to.be.eq(true)
      expect(modifiedClone).length(1)
    })

    test('params', async () => {
      const { string } = cds.entities('basic.literals')

      const cqn = cds.ql`SELECT FROM ${string} where string = :string`

      const first = await cds.run(cqn, { string: 'yes' })
      const second = await cds.run(cqn, { string: 'yes' })
      const third = await cds.run(cqn, { string: 'no' })
      cqn.where`string = ${'no'}`
      const modified = await cds.run(cqn, { string: 'yes' })
      const modifiedClone = await cds.run(cqn.clone(), { string: 'yes' })

      expect(first).length(1)
      expect(second).length(first.length)
      expect(third).length(1)

      expect(second[0].string).to.eq(first[0].string)
      expect(third[0].string).to.not.eq(first[0].string)

      expect(modified.length === first.length || modified.length === modifiedClone.length).to.be.eq(true)
      expect(modifiedClone).length(0)
    })

  })

  const methods = [{
    method: 'INSERT'
  }, {
    method: 'UPSERT'
  }]
  describe.each(methods)('$method', ({ method }) => {
    beforeEach(async () => {
      const { keys } = cds.entities('basic.common')
      await DELETE.from(keys).where`true`
    })

    test('entries', async () => {
      const { keys } = cds.entities('basic.common')

      const cqn = cds.ql[method].into(keys)

      let i = 0
      const row = () => ({ id: i, data: `${i++}` })
      const gen = function* (count) { while (count--) yield row() }
      const str = function* (count) {
        let sep = ''
        yield '['
        for (const r of gen(count)) {
          yield sep
          sep = ','
          yield JSON.stringify(r)
        }
        yield ']'
      }

      const first = await cds.run(cqn, row())
      const second = await cds.run(cqn, [row(), row()])
      const third = await cds.run(cqn, Readable.from(str(3), { objectMode: false }))
      // const fourth = await cds.run(cqn, gen(4))
      expect(first | 0).eq(1)
      expect(second | 0).eq(2)
      expect(third | 0).eq(3)
      // expect(fourth | 0).eq(4)

      for (const r of await SELECT.from(keys)) {
        expect(r.data).lt(i)
      }
    })

    test('rows', async () => {
      const { keys } = cds.entities('basic.common')

      const cqn = cds.ql[method].into(keys)
      cqn[method].columns = ['id', 'data']

      let i = 0
      const row = () => ([i, `${i++}`])
      const gen = function* (count) { while (count--) yield row() }
      const str = function* (count) {
        let sep = ''
        yield '['
        for (const r of gen(count)) {
          yield sep
          sep = ','
          yield JSON.stringify(r)
        }
        yield ']'
      }
      const first = await cds.run(cqn, [row()])
      const second = await cds.run(cqn, [row(), row()])
      const third = await cds.run(cqn, Readable.from(str(3), { objectMode: false }))
      // const fourth = await cds.run(cqn, gen(4))
      expect(first | 0).eq(1)
      expect(second | 0).eq(2)
      expect(third | 0).eq(3)
      // expect(fourth | 0).eq(4)

      for (const r of await SELECT.from(keys)) {
        expect(r.data).lt(i)
      }
    })

    test('as', async () => {
      const { keys } = cds.entities('basic.common')

      await cds.ql[method]({ id: -1, data: '-1' }).into(keys)
      // :)
      const cqn = cds.ql[method](cds.ql`SELECT id + :id as id:Integer, :data as data:String from ${keys}`).into(keys)

      let i = 1
      const first = await cds.run(cqn, { id: i, data: `${i++}` })
      const second = await cds.run(cqn, { id: i, data: `${i++}` })

      expect(first | 0).eq(1)
      expect(second | 0).eq(2)

      for (const r of await SELECT.from(keys)) {
        expect(r.data).lt(i)
      }
    })
  })

})