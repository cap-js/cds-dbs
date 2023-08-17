const cds = require('../../cds.js')
const cap_issue = cds.utils.path.resolve(__dirname, 'model')
const admin = {
  auth: {
    username: 'alice',
  },
}
describe('cap issues', () => {
  const { expect, GET } = cds.test(cap_issue)
  test('make sure that in a localized scenario, aliases in on-conditions are properly replaced', async () => {
    const res = await GET('/srv/P(ID=2)/boos', admin)

    expect(res.status).to.be.eq(200)
  })
})
