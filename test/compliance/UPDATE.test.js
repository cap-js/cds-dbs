const cds = require('../cds.js')
const Books = 'complex.associations.Books'
const BooksUnique = 'complex.uniques.Books'
const PagesUnique = 'complex.uniques.Pages'

describe('UPDATE', () => {
  const { expect } = cds.test(__dirname + '/resources')

  const uniques = {
    number: { integer64: '201503001904' },
    string: { medium: 'UPDATE.test.js' },
  }

  before(async () => {
    const { string, number } = cds.entities('basic.literals')

    await INSERT({ string: 'initial', ...uniques.string }).into(string)
    await INSERT({ integer32: 0, ...uniques.number }).into(number)
  })

  after(async () => {
    const { string, number } = cds.entities('basic.literals')
    const { Order } = cds.entities('complex.keywords')

    await DELETE.from(number).where(uniques.number)
    await DELETE.from(string).where(uniques.string)
    await DELETE.from(Order).where({ ID: [2015, 300, 1904] })
  })

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
      await UPDATE(string).data({ string: 'updated' }).where(uniques.string)
      const result = await SELECT.one.from(string).where(uniques.string)
      expect(result.string).to.equal('updated')
    })

    test('number', async () => {
      const { number } = cds.entities('basic.literals')
      await UPDATE(number).data({ integer32: 3 }).where(uniques.number)
      const result = await SELECT.one.from(number).where(uniques.number)
      expect(result.integer32).to.equal(3)
    })

    test('smart quoting', async () => {
      const { Order } = cds.entities('complex.keywords')
      const data = {
        ID: 2015,
        alter: [
          {
            ID: 300,
            number: null,
            order_ID: 2015,
          },
          {
            ID: 1904,
            number: null,
            order_ID: 2015,
          },
        ],
      }
      await INSERT(data).into(Order)
      const select = await cds.run(cds.ql`SELECT from ${Order} { ID, alter { * } } where ID=2015 and exists alter`)
      expect(select[0]).to.deep.eql(data)

      data.alter.forEach(e => (e.number = 99)) // change data
      await UPDATE.entity(Order).with(data).where('ID=2015 and exists alter')

      const selectAfterChange = await cds.run(cds.ql`SELECT from ${Order} { ID, alter { * } } where ID=2015 and exists alter`)
      expect(selectAfterChange[0]).to.deep.eql(data)
    })
  })

  describe('with', () => {
    test('val', async () => {
      const { string } = cds.entities('basic.literals')
      await UPDATE(string).with({ string: { val: 'updated' } }).where(uniques.string)
      const result = await SELECT.one.from(string).where(uniques.string)
      expect(result.string).to.equal('updated')
    })

    test('xpr', async () => {
      const { number } = cds.entities('basic.literals')
      await UPDATE(number).data({ integer32: 1 }).where(uniques.number)
      await UPDATE(number).with({ integer32: { xpr: [{ ref: ['integer32'] }, '+', { val: 2 }] } }).where(uniques.number)
      const result = await SELECT.one.from(number).where(uniques.number)
      expect(result.integer32).to.equal(3)
    })

    test('func', async () => {
      const { string } = cds.entities('basic.literals')
      await UPDATE(string).with({ string: { func: 'concat', args: [{ val: 'a' }, { val: 'b' }] } }).where(uniques.string)
      const result = await SELECT.one.from(string).where(uniques.string)
      expect(result.string).to.equal('ab')
    })

    test('non existing values', async () => {
      const { string } = cds.entities('basic.literals')
      try {
        await UPDATE(string).with({ nonExisting: { val: 'not updated' } }).where(uniques.string)
        // should not get here
        expect(0).to.be(1)
      } catch (error) {
        // nonExisting is filtered, so the sql is incomplete
        expect(error.query).to.match(/UPDATE basic_literals_string AS ["]?\$s["]? SET [\n]?/i)
      }
    })
  })

  describe('data + with', () => {
    test('string', async () => {
      const { string } = cds.entities('basic.literals')
      await UPDATE(string)
        .data({ string: 'updated' })
        .with({ short: { func: 'concat', args: [{ val: 'a' }, { val: 'b' }] } })
        .where(uniques.string)
      const result = await SELECT.one.from(string).where(uniques.string)
      expect(result.string).to.equal('updated')
      expect(result.short).to.equal('ab')
    })

    test('number', async () => {
      const { number } = cds.entities('basic.literals')
      await UPDATE(number)
        .data({ integer32: 0 })
        .where(uniques.number)
      await UPDATE(number)
        .data({ integer32: 1 })
        .with({ integer16: { xpr: [{ ref: ['integer32'] }, '+', { val: 2 }] } })
        .where(uniques.number)
      const result = await SELECT.one.from(number).where(uniques.number)
      expect(result.integer32).to.equal(1)
      expect(result.integer16).to.equal(2)
    })
  })

  describe('where', () => {
    after(async () => {
      await DELETE.from(Books).where({ ID: [2015, 300] })
    })

    test('flat with or on key', async () => {
      const insert = await cds.run(
        INSERT.into(Books).entries([
          { ID: 2015, title: 'foo' },
          { ID: 300, title: 'bar' },
        ]),
      )
      expect(insert.affectedRows).to.equal(2)

      const update = await cds.run(
        UPDATE.entity(Books)
          .set({ title: 'foo' })
          .where({ ID: 2015, or: { ID: 300 } }),
      )
      expect(update).to.equal(2)
    })
  })

  describe('uniques in deep updates', () => {
    after(async () => {
      await DELETE.from(PagesUnique).where({ ID: [300, 1904, 1503, 201503] })
      await DELETE.from(BooksUnique).where({ ID: 2015 })
    })

    test('2nd level unique constraints', async () => {
      // number must be unique for each book
      const data = {
        ID: 2015,
        title: 'foo',
        pages: [
          // Set both numbers to the same value to be conflicting
          { ID: 300, number: 0 },
          { ID: 1904, number: 0 },
        ],
      }

      await DELETE.from(BooksUnique).where(`ID=${2015}`)
      await expect(INSERT(data).into(BooksUnique)).rejected

      // Update the numbers to be non conflicting
      data.pages[0].number = 1
      data.pages[1].number = 2
      await INSERT(data).into(BooksUnique)

      // Create new entries with conflicting numbers
      data.pages[0].ID = 1503
      data.pages[1].ID = 19
      await UPDATE(BooksUnique).data(data).where(`ID = ${data.ID}`) // first, old entries are deleted, so no violation

      data.pages[0].ID = 201503
      data.pages[0].number = 1 // would fail without the update below first
      data.pages[1].number = 999
      await UPDATE(BooksUnique).data(data).where(`ID = ${data.ID}`)
    })
  })
})
