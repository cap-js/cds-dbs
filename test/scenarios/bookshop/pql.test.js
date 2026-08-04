const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

const admin = {
  auth: {
    username: 'alice',
  },
}

describe('Bookshop - pql', () => {
  cds.log('pql', 'debug')
  cds.log('sql', 'debug')
  const { GET, expect, log: _testLog } = cds.test(bookshop)
  const testLog = _testLog()

  test('groupby simple properties', async () => {
    const res = await GET('/admin/Books?$apply=groupby((ID))', admin)
    expect(res.status).to.be.eq(200)
  })

  test('groupby path expression', async () => {
    const res = await GET('/admin/Books?$apply=groupby((author/placeOfBirth))', admin)
    expect(res.status).to.be.eq(200)

    expect(testLog.output).not.to.be(null)
  })
})
