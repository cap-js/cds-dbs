'use strict'
const cds = require('../../test/cds.js')
const { expect } = cds.test(__dirname + '/resources')

describe('keywords', () => {
  test('insert, update, select', async () => {
    const { Order } = cds.entities
    const data = {
      ID: 1,
      alter: [
        {
          ID: 42,
          number: null,
          order_ID: 1,
        },
        {
          ID: 43,
          number: null,
          order_ID: 1,
        },
      ],
    }
    await INSERT(data).into(Order)
    const select = await cds.run(CQL`SELECT from Order { ID, alter { * } } where exists alter`)
    expect(select[0]).to.deep.eql(data)

    data.alter.forEach(e => e.number = 99) // change data
    await UPDATE.entity(Order).with(data).where('exists alter') 

    const selectAfterChange = await cds.run(CQL`SELECT from Order { ID, alter { * } } where exists alter`)
    expect(selectAfterChange[0]).to.deep.eql(data)
  })
})
