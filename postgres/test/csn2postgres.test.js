const cds = require('../../test/cds.js')

describe('CSN to PostgreSQL', () => {
  describe('Create Statements', () => {
    test('should return PostgreSQL compatible statements for beershop-service', async () => {
      const servicePath = `${__dirname}/beershop/srv/beershop-service`
      const csn = await cds.load(servicePath)
      const sql = cds.compile(csn).to.sql({ dialect: 'postgres', as: 'str' })
      // REVISIT: snapshot contains data types without TIMEZONE - update after cds compiler change - see #152
      expect(sql).toMatchSnapshot()
    })
    test('should return PostgreSQL compatible statements for beershop-admin-service', async () => {
      const servicePath = `${__dirname}/beershop/srv/beershop-admin-service`
      const csn = await cds.load(servicePath)
      const sql = cds.compile(csn).to.sql({ dialect: 'postgres', as: 'str' })
      // REVISIT: snapshot contains data types without TIMEZONE - update after cds compiler change - see #152
      expect(sql).toMatchSnapshot()
    })
  })
})
