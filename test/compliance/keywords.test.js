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

    data.alter.forEach(e => (e.number = 99)) // change data
    await UPDATE.entity(Order).with(data).where('exists alter')

    const selectAfterChange = await cds.run(CQL`SELECT from Order { ID, alter { * } } where exists alter`)
    expect(selectAfterChange[0]).to.deep.eql(data)
  })

  test('insert as select', async () => {
    const { Alter, ASC } = cds.entities
    // fill other table first
    await cds.run(INSERT({ ID: 1, alias: 42 }).into(ASC))
    await INSERT.into(Alter)
      .columns(['ID', 'number'])
      .as(
        SELECT.from(ASC)
          .columns(['ID', 'alias'])
          .where({ ref: ['alias'] }, '=', { val: 42 }),
      )
    const select = await SELECT.from(Alter).where('number = 42')
    expect(select[0]).to.eql({ ID: 1, number: 42, order_ID: null })
  })
})
