const cds = require('../../cds.js')
const bookshop = require('path').resolve(__dirname, '../../bookshop')

const admin = {
  auth: {
    username: 'alice',
  },
}

describe.skip('Bookshop - Search', () => {
  const { expect, GET } = cds.test(bookshop)

  // Skipping $search tests as the github action HANA version does not support SCORE
  test('Search book', async () => {
    const res = await GET('/admin/Books?$search=cat', admin)
    expect(res.status).to.be.eq(200)
    expect(res.data.value.length).to.be.eq(1)
    expect(res.data.value[0].title).to.be.eq('Catweazle')
  })

  test('Search book with space and quotes', async () => {
    const res = await GET('/admin/Books?$search="e R"', admin)
    expect(res.status).to.be.eq(200)
    expect(res.data.value.length).to.be.eq(2)
    expect(res.data.value[0].title).to.be.eq('The Raven')
    expect(res.data.value[1].descr).to.include('e r')
  })

  test('Search book with filter', async () => {
    const res = await GET('/admin/Books?$search="e R"&$filter=ID eq 251 or ID eq 271', admin)
    expect(res.status).to.be.eq(200)
    expect(res.data.value.length).to.be.eq(2)
    expect(res.data.value[0].title).to.be.eq('The Raven')
    expect(res.data.value[1].descr).to.include('e r')
    expect(res.data.value[0].ID).to.be.eq(251)
    expect(res.data.value[1].ID).to.be.eq(271)
  })

  // search expression operating on aggregated results, must be put into the having clause
  describe('with aggregate function', () => {
    test('min', async () => {
      const { Books } = cds.entities
      let res = await SELECT.from(Books)
        .columns({ args: [{ ref: ['title'] }], as: 'firstInAlphabet', func: 'MIN' })
        .groupBy('title')
        .search('Cat')
      expect(res.length).to.be.eq(1)
    })
  })

})
