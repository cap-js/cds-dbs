const cds = require('../../cds.js')
const cap_issue = cds.utils.path.resolve(__dirname, 'model')

describe.only('cap issue - Read', () => {
  const { expect, GET } = cds.test(cap_issue)
  test('Books', async () => {
    const res = await GET('/srv/P(ID=2)/boos', { headers: { 'accept-language': 'de' } })

    expect(res.status).to.be.eq(200)
  })
})
