const cds = require('../../test/cds')

describe('HANA custom functions', () => {
  const { expect } = cds.test(__dirname, 'fuzzy.cds')

  test('current_utctimestamp', async () => {
    const cqn = { SELECT: {
      one: true,
      from: {ref: ['DUMMY']}, 
      columns: [
        {func: 'current_utctimestamp', as: 'no_args'},
        {func: 'current_utctimestamp', args: [{val: 0}], as: 'prec0'},
        {func: 'current_utctimestamp', args: [{val: 3}], as: 'prec3'},
        {func: 'current_utctimestamp', args: [{val: 7}], as: 'prec7'}] 
    }}

    const res = await cds.run(cqn)

    expect(res.no_args.match(/\.(\d\d\d)0000/)).not.to.be.null // default 3
    expect(res.prec0.match(/\.0000000/)).not.to.be.null
    expect(res.prec3.match(/\.(\d\d\d)0000/)).not.to.be.null
    expect(res.prec7.match(/\.(\d\d\d\d\d\d\d)/)).not.to.be.null


  })
})