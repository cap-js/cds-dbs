const cds = require('../../test/cds')

describe('HANA native functions', () => {
  const { expect } = cds.test(__dirname, 'fuzzy.cds')

  describe('current_timestamp', () => {
    test('no arguments', async () => {
      const { Books } = cds.entities('sap.capire.bookshop')
      const [{ no, p1, p2, p3, p4, p5, p6, p7 }] = await cds.ql`SELECT FROM ${Books} {
        CURRENT_UTCTIMESTAMP() AS no,
        CURRENT_UTCTIMESTAMP(0) AS p0,
        CURRENT_UTCTIMESTAMP(1) AS p1,
        CURRENT_UTCTIMESTAMP(2) AS p2,
        CURRENT_UTCTIMESTAMP(3) AS p3,
        CURRENT_UTCTIMESTAMP(4) AS p4,
        CURRENT_UTCTIMESTAMP(5) AS p5,
        CURRENT_UTCTIMESTAMP(6) AS p6,
        CURRENT_UTCTIMESTAMP(7) AS p7,
      }`

      expect(/\.\d{3}0{4}/.test(no)).true // default 3
      expect(/\.\d{1}0{6}/.test(p1)).true
      expect(/\.\d{2}0{5}/.test(p2)).true
      expect(/\.\d{3}0{4}/.test(p3)).true
      expect(/\.\d{4}0{3}/.test(p4)).true
      expect(/\.\d{5}0{2}/.test(p5)).true
      expect(/\.\d{6}0{1}/.test(p6)).true
      expect(/\.\d{7}/.test(p7)).true
    })
  })
})