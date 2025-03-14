'use strict'
const cds = require('../../test/cds.js')

describe('keywords', () => {
  const { expect } = cds.test(__dirname + '/resources')

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
    const select = await cds.run(cds.ql`SELECT from Order { ID, alter { * } } where exists alter`)
    expect(select[0]).to.deep.eql(data)

    data.alter.forEach(e => (e.number = 99)) // change data
    await UPDATE.entity(Order).with(data).where('exists alter')

    const selectAfterChange = await cds.run(cds.ql`SELECT from Order { ID, alter { * } } where exists alter`)
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

  test('upsert with columns', async () => {
    const { ASC } = cds.entities
    await UPSERT.into(ASC)
      .columns(['ID', 'select'])
      .rows([[42, 4711]])
    let select = await SELECT.one.from(ASC, ['ID', 'select']).where('ID = 42')
    expect(select).to.eql({ ID: 42, select: 4711 })

    await UPSERT.into(ASC).entries({ ID: 42, alias: 9 })
      .columns(['ID', 'select'])
      .rows([[42, 4711]])
    select = await SELECT.one.from(ASC).where('ID = 42')
    expect(select).to.eql({ ID: 42, select: 4711, alias: 9 })
  })
})
