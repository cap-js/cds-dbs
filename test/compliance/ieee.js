const cds = require('../cds.js')

module.exports = (flag, format, values) => {
  describe(`ieee 754 compatible ${flag}`, () => {
    const { expect } = cds.test(__dirname + '/resources')

    beforeEach(async () => {
      const { number } = cds.entities('basic.literals')
      await DELETE.from(number)
      await INSERT.into(number).entries([
        { integer64: 1, float: 1.1, decimal: 1.1 },
        { integer64: '2', float: '2.1', decimal: '2.1' }
      ])
    })

    test(`selected as ${format}`, async () => {
      const { number } = cds.entities('basic.literals')
      const res = await SELECT.from(number)
      expect(res[0]).to.contain(values[0])
      expect(res[1]).to.contain(values[1])
    })
  })
}
