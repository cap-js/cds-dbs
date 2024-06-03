const cds = require('../cds.js')

describe('datetime handling', () => {
  const { expect } = cds.test(__dirname + '/resources')
  test('datetime elements as key', async () => {
    let res
    const payload = { dt: '2020-12-31T01:02:03Z', int: 4711}
    res = await cds.db.run(INSERT.into('DateTimeEntity').entries(payload))
    res = await cds.db.run(SELECT.one.from('DateTimeEntity').where({dt: new Date(payload.dt).toISOString() }))
    expect(res).to.containSubset(payload)
    res = await cds.db.run(SELECT.one.from('DateTimeEntity').where({dt: new Date(payload.dt) }))
    expect(res).to.containSubset(payload)
    res = await cds.db.run(SELECT.one.from('DateTimeEntity').where({dt: payload.dt }))
    expect(res).to.containSubset(payload)
  })

  test('$now in view', async () => {
    const req_timestamp = new Date()
    await cds.db.run(INSERT.into('TimestampEntity').entries({ ID: 1, ts: req_timestamp }))
    const { now } = await cds.db.run(SELECT.one.from('TimestampView'))
    expect(now.match(/\.(\d\d\d)Z/)[1].match(/000/)).to.be.null //> check that we get ms precision
    const diff = Math.abs(req_timestamp - Date.now())
    expect(diff).to.be.lt(1000) //> check that we get the same timezone offset
  })
})
