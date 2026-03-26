process.env.CDS_ENV = 'real'
const cds = require('../../../test/cds.js')

describe('SQLite decimal affinity real', () => {
  const { expect, data } = cds.test(__dirname, '--profile', 'real')

  beforeEach(data.reset)

  test('check pipeline sqlite version', async () => {
    const db = await cds.connect.to('db')
    const res = await db.run('SELECT sqlite_version() as v')
    const version = res[0]?.v
    expect(version).to.equal('THE RIGHT VERSION')
  })

  test('profile "real" should be active', async () => {
    const db = await cds.connect.to('db')
    const CQN2SQL = db.constructor.CQN2SQL

    // cds.env config
    expect(cds.env.features.ieee754compatible).to.equal(true)
    expect(cds.env.requires.db.decimal_affinity).to.equal('real')
    expect(cds.env.cdsc.sqliteRealAffinityForDecimal).to.equal(true)

    // CQN2SQL static properties (evaluated at class load time)
    expect(typeof CQN2SQL.OutputConverters.Decimal).to.equal('function')
    expect(typeof CQN2SQL.TypeMap.Decimal).to.equal('function')
    expect(CQN2SQL.TypeMap.Decimal()).to.equal('REAL_DECIMAL')
  })

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

    test('should interpret an inserted integer value as a real', async () => {
      const { EntityWithDecimalFields } = cds.entities('cap.dbs.test.sqlite.general.schema')

      const insertResult = await INSERT.into(EntityWithDecimalFields).entries([{ plainDecimal: 123 }])

      expect(insertResult).to.be.ok
      expect(insertResult.results?.length).to.equal(1)
      expect(insertResult.results[0].changes).to.equal(1)

      const selectResult = await SELECT.from(EntityWithDecimalFields)

      expect(selectResult).to.be.ok
      expect(selectResult[0].plainDecimal).to.equal('123.0')
    })

    test('should interpret an inserted string value as a real', async () => {
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

    test('should convert an entered string value into a real', async () => {
      const { EntityWithDecimalFields } = cds.entities('cap.dbs.test.sqlite.general.schema')

      const insertResult = await INSERT.into(EntityWithDecimalFields).entries([{ plainDecimal: '123456' }])

      expect(insertResult).to.be.ok
      expect(insertResult.results?.length).to.equal(1)
      expect(insertResult.results[0].changes).to.equal(1)

      const selectResult = await SELECT.from(EntityWithDecimalFields)

      expect(selectResult).to.be.ok
      expect(selectResult[0].plainDecimal).to.equal('123456.0')
    })
  })
})
