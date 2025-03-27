const cds = require('../cds.js')
const Books = 'complex.associations.Books'
const BooksUnique = 'complex.uniques.Books'

describe('UPDATE', () => {
  const { data, expect } = cds.test(__dirname + '/resources')
  data.autoIsolation(true)
  data.autoReset()

  describe('entity', () => {
    test('string', async () => {
      const { string } = cds.entities('basic.literals')
      const changes = await UPDATE.entity(string)
      expect(changes).to.equal(0)
    })
  })

  describe('data', () => {
    test('string', async () => {
      const { string } = cds.entities('basic.literals')
      await UPDATE(string).data({ string: 'updated' })
      const result = await SELECT.one.from(string)
      expect(result.string).to.equal('updated')
    })

    test('number', async () => {
      const { number } = cds.entities('basic.literals')
      await INSERT({ integer32: 0 }).into(number)
      await UPDATE(number).data({ integer32: 3 })
      const result = await SELECT.one.from(number)
      expect(result.integer32).to.equal(3)
    })
  })

  describe('with', () => {
    test('val', async () => {
      const { string } = cds.entities('basic.literals')
      await UPDATE(string).with({ string: { val: 'updated' } })
      const result = await SELECT.one.from(string)
      expect(result.string).to.equal('updated')
    })

    test('xpr', async () => {
      const { number } = cds.entities('basic.literals')
      await INSERT({ integer32: 1 }).into(number)
      await UPDATE(number).with({ integer32: { xpr: [{ ref: ['integer32'] }, '+', { val: 2 }] } })
      const result = await SELECT.one.from(number)
      expect(result.integer32).to.equal(3)
    })

    test('func', async () => {
      const { string } = cds.entities('basic.literals')
      await UPDATE(string).with({ string: { func: 'concat', args: [{ val: 'a' }, { val: 'b' }] } })
      const result = await SELECT.one.from(string)
      expect(result.string).to.equal('ab')
    })

    test('non existing values', async () => {
      const { string } = cds.entities('basic.literals')
      try {
        await UPDATE(string).with({ nonExisting: { val: 'not updated' } })
        // should not get here
        expect(0).to.be(1)
      } catch (error) {
        // nonExisting is filtered, so the sql is incomplete
        expect(error.query).to.match(/UPDATE basic_literals_string AS ["]?string["]? SET [\n]?/i)
      }
    })
  })

  describe('data + with', () => {
    test('string', async () => {
      const { string } = cds.entities('basic.literals')
      await UPDATE(string)
        .data({ string: 'updated' })
        .with({ medium: { func: 'concat', args: [{ val: 'a' }, { val: 'b' }] } })
      const result = await SELECT.one.from(string)
      expect(result.string).to.equal('updated')
      expect(result.medium).to.equal('ab')
    })

    test('number', async () => {
      const { number } = cds.entities('basic.literals')
      await INSERT({ integer32: 0 }).into(number)
      await UPDATE(number)
        .data({ integer32: 1 })
        .with({ integer64: { xpr: [{ ref: ['integer32'] }, '+', { val: 2 }] } })
      const result = await SELECT.one.from(number)
      expect(result.integer32).to.equal(1)
      expect(result.integer64).to.equal('2')
    })
  })

  describe('where', () => {
    test('flat with or on key', async () => {
      const insert = await cds.run(
        INSERT.into(Books).entries([
          { ID: 5, title: 'foo' },
          { ID: 6, title: 'bar' },
        ]),
      )
      expect(insert.affectedRows).to.equal(2)

      const update = await cds.run(
        UPDATE.entity(Books)
          .set({ title: 'foo' })
          .where({ ID: 5, or: { ID: 6 } }),
      )
      expect(update).to.equal(2)
    })
  })

  describe('uniques in deep updates', () => {
    test('2nd level unique constraints', async () => {
      // number must be unique for each book
      const data = {
        ID: 1,
        title: 'foo',
        pages: [
          // Set both numbers to the same value to be conflicting
          { ID: 1, number: 0 },
          { ID: 2, number: 0 },
        ],
      }

      await DELETE.from(BooksUnique).where(`ID=${1}`)
      await expect(INSERT(data).into(BooksUnique)).rejected

      // Update the numbers to be non conflicting
      data.pages[0].number = 1
      data.pages[1].number = 2
      await INSERT(data).into(BooksUnique)

      // Create new entries with conflicting numbers
      data.pages[0].ID = 3
      data.pages[1].ID = 4
      await UPDATE(BooksUnique).data(data) // first, old entries are deleted, so no violation

      data.pages[0].ID = 5
      data.pages[0].number = 1 // would fail without the update below first
      data.pages[1].number = 999
      await UPDATE(BooksUnique).data(data)
    })
  })
})
