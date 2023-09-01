const cds = require('../../../test/cds.js')

cds.test(__dirname, 'testModel.cds')

describe('datetime handling', () => {
  test('datetime elements as key', async () => {
    let res
    const payload = { dt: '2020-12-31T01:02:03Z', int: 4711}
    res = await cds.db.run(INSERT.into('DateTimeEntity').entries(payload))
    res = await cds.db.run(SELECT.one.from('DateTimeEntity').where({dt: new Date(payload .dt).toISOString() })) // this finds the value
    expect(res).toMatchObject(payload)
    res = await cds.db.run(SELECT.one.from('DateTimeEntity').where({dt: payload.dt})) // this returns undefined
    expect(res).toMatchObject(payload)
  })
})
