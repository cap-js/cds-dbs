'use strict'
const cds = require('../../../test/cds.js')
cds.test(__dirname, 'testModel.cds')

describe('keywords', () => {
  test('insert, update, select', async () => {
    // fill other table first
    const { Order } = cds.entities
    await INSERT({ ID: 42, order: 'foo' }).into(Order)
    const select = await SELECT.from(Order).where(`Order.order = 'foo'`)
    expect(select).toMatchObject([{ ID: 42, order: 'foo' }])
    await UPDATE.entity(Order).with({ order: 'bar' }).where({ ID: 42 })
    const selectAfterChange = await SELECT.from(Order).where(`Order.order = 'bar'`)
    expect(selectAfterChange).toMatchObject([{ ID: 42, order: 'bar' }])
  })
})
