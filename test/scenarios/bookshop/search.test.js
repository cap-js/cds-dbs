const cds = require('../../cds.js')
const bookshop = require('path').resolve(__dirname, '../../bookshop')

describe('Bookshop - Search', () => {
  const { expect } = cds.test(bookshop)

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
