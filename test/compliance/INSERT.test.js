const cds = require('../cds')

describe('INSERT', () => {
  const { data, expect } = cds.test(__dirname + '/resources')
  data.autoIsolation(true)

  describe('into', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  describe('entries', () => {
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

  describe('as', () => {
    test('smart quoting', async () => {
      const { Alter, ASC } = cds.entities('complex.keywords')
      // fill other table first
      await cds.run(INSERT({ ID: 1, alias: 42 }).into(ASC))
      await INSERT.into(Alter)
        .columns(['ID', 'number'])
        .as(
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
})
