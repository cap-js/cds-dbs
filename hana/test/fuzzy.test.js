const cds = require('../../test/cds')

describe('Fuzzy search', () => {
  const { expect } = cds.test(__dirname, 'fuzzy.cds')

  test('select', async () => {
    const { Books } = cds.entities('sap.capire.bookshop')
    const res = await SELECT.from(Books).where({
      func: 'contains',
      args: [
        { list: [{ ref: ['title'] }, { ref: ['descr'] }] },
        { val: 'poem' },
        { func: 'FUZZY', args: [{ val: 0.8 }, { val: 'similarCalculationMode=searchCompare' }] }
      ]
    })

    expect(res).to.have.property('length').to.be.eq(1)
  })
})