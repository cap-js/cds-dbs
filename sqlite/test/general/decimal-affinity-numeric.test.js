process.env.CDS_ENV = 'numeric'
const cds = require('../../../test/cds.js')

describe('SQLite decimal affinity numeric', () => {
  const { expect, data } = cds.test(__dirname, '--profile', 'numeric')

  beforeEach(data.reset)

  describe('when inserting data into a plain decimal field', () => {
    test('should allow to store a plain decimal value', async () => {
      const { EntityWithDecimalFields } = cds.entities('cap.dbs.test.sqlite.general.schema')

      const insertResult = await INSERT.into(EntityWithDecimalFields).entries([{ plainDecimal: 123.456 }])

      expect(insertResult).to.be.ok
      expect(insertResult.results?.length).to.equal(1)
      expect(insertResult.results[0].changes).to.equal(1)

      const selectResult = await SELECT.from(EntityWithDecimalFields)

      expect(selectResult).to.be.ok
      expect(selectResult[0].plainDecimal).to.equal('123.456')
    })

    test('should interpret an inserted integer value as a numeric', async () => {
      const { EntityWithDecimalFields } = cds.entities('cap.dbs.test.sqlite.general.schema')

      const insertResult = await INSERT.into(EntityWithDecimalFields).entries([{ plainDecimal: 123 }])

      expect(insertResult).to.be.ok
      expect(insertResult.results?.length).to.equal(1)
      expect(insertResult.results[0].changes).to.equal(1)

      const selectResult = await SELECT.from(EntityWithDecimalFields)

      expect(selectResult).to.be.ok
      expect(selectResult[0].plainDecimal).to.equal('123')
    })

    test('should interpret an inserted string value as a numeric', async () => {
      const { EntityWithDecimalFields } = cds.entities('cap.dbs.test.sqlite.general.schema')

      const insertResult = await INSERT.into(EntityWithDecimalFields).entries([{ plainDecimal: '123.456' }])

      expect(insertResult).to.be.ok
      expect(insertResult.results?.length).to.equal(1)
      expect(insertResult.results[0].changes).to.equal(1)

      const selectResult = await SELECT.from(EntityWithDecimalFields)

      expect(selectResult).to.be.ok
      expect(selectResult[0].plainDecimal).to.equal('123.456')
    })
  })

  describe('when inserting data into a decimal field with precision and scale', () => {
    test('will keep digits that exceed precision and scale', async () => {
      const { EntityWithDecimalFields } = cds.entities('cap.dbs.test.sqlite.general.schema')

      const insertResult = await INSERT.into(EntityWithDecimalFields).entries([{ plainDecimal: 123456.789 }])

      expect(insertResult).to.be.ok
      expect(insertResult.results?.length).to.equal(1)
      expect(insertResult.results[0].changes).to.equal(1)

      const selectResult = await SELECT.from(EntityWithDecimalFields)

      expect(selectResult).to.be.ok
      expect(selectResult[0].plainDecimal).to.equal('123456.789')
    })

    test('should convert an entered string value into a decimal', async () => {
      const { EntityWithDecimalFields } = cds.entities('cap.dbs.test.sqlite.general.schema')

      const insertResult = await INSERT.into(EntityWithDecimalFields).entries([{ plainDecimal: '123456' }])

      expect(insertResult).to.be.ok
      expect(insertResult.results?.length).to.equal(1)
      expect(insertResult.results[0].changes).to.equal(1)

      const selectResult = await SELECT.from(EntityWithDecimalFields)

      expect(selectResult).to.be.ok
      expect(selectResult[0].plainDecimal).to.equal('123456')
    })
  })
})
