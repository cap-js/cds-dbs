const cds = require('../../test/cds')

describe('HANA native functions', () => {
  const { expect } = cds.test(__dirname, 'fuzzy.cds')

  describe('current_timestamp', () => {
    test('no arguments', async () => {
      const cqn = { SELECT: {
        one: true,
        from: {ref: ['DUMMY']}, 
        columns: [{func: 'CURRENT_UTCTIMESTAMP', as: 'NO'}]
      }}

      const res = await cds.run(cqn)

      expect(res.NO.match(/\.(\d\d\d)0{0,4}/)).not.to.be.null // default 3
    })

    // HXE does not allow args
    test.skip('0 skips ms precision', async () => {
      const cqn = { SELECT: {
        one: true,
        from: {ref: ['DUMMY']}, 
        columns: [
          {func: 'current_utctimestamp', as: 'NO'},
          {func: 'current_utctimestamp', args: [{val: 0}], as: 'P0'}]
      }}
  
      const res = await cds.run(cqn)

      expect(res.P0.match(/\.0000000/)).not.to.be.null
    })

    // HXE does not allow args
    test.skip('arbitrary values', async () => {
      const cqn = { SELECT: {
        one: true,
        from: {ref: ['DUMMY']}, 
        columns: [
          {func: 'current_utctimestamp', args: [{val: 3}], as: 'P3'},
          {func: 'current_utctimestamp', args: [{val: 7}], as: 'P7'}] 
      }}
  
      const res = await cds.run(cqn)
  
      expect(res.P3.match(/\.(\d\d\d)0000/)).not.to.be.null
      expect(res.P7.match(/\.(\d\d\d\d\d\d\d)/)).not.to.be.null
    })
  })
})