const cds = require('../../test/cds')
const bookshop = cds.utils.path.resolve(__dirname, '../../test/bookshop')

describe('when local schema contains a table named DUMMY', () => {
  const { expect } = cds.test(bookshop)

  beforeEach(async () => {
    await cds.run('CREATE TABLE DUMMY (DUMMY NVARCHAR(1))')
  })

  afterEach(async () => {
    await DELETE.from('sap.capire.bookshop.Books').where({ ID: 99999 })
    await cds.run('DROP TABLE DUMMY')
  })

  test('local DUMMY table shadows SYS.DUMMY', async () => {
    const [{ count }] = await cds.run('SELECT COUNT(*) AS count FROM DUMMY')
    expect(count).to.eq(0)
  })

  test('INSERT must insert a record even when local DUMMY table exists', async () => {
    await INSERT.into('sap.capire.bookshop.Books').entries([{ ID: 99999, title: 'Local DUMMY shadow repro' }])

    const result = await SELECT.from('sap.capire.bookshop.Books').where({ ID: 99999 })
    expect(result).to.have.length(1)
  })
})
