const cds = require('../cds.js')

describe('datetime handling', () => {
  cds.test(__dirname + '/resources')
  test('datetime elements as key', async () => {
    let res
    const payload = { dt: '2020-12-31T01:02:03Z', int: 4711}
    res = await cds.db.run(INSERT.into('DateTimeEntity').entries(payload))
    res = await cds.db.run(SELECT.one.from('DateTimeEntity').where({dt: new Date(payload .dt).toISOString() }))
    expect(res).toMatchObject(payload)
    res = await cds.db.run(SELECT.one.from('DateTimeEntity').where({dt: new Date(payload .dt).toISOString() }))
    expect(res).toMatchObject(payload)
    res = await cds.db.run(SELECT.one.from('DateTimeEntity').where({dt: payload.dt}))
    expect(res).toMatchObject(payload)
  })

  test('$now in view', async () => {
    const req_timestamp = new Date().toISOString()
    await cds.db.run(INSERT.into('TimestampEntity').entries({ ID: 1, ts: req_timestamp }))
    const { now } = await cds.db.run(SELECT.one.from('TimestampView'))
    expect(now.match(/\.(\d\d\d)Z/)[1].match(/000/)).toBeNull() //> check that we get ms precision
    const diff = Math.abs(new Date(req_timestamp).getTime() - new Date(now).getTime())
    expect(diff).toBeLessThan(1000) //> check that we get the same timezone offset
  })
})
