const cds = require('../cds.js')

describe('datetime handling', () => {
  const { expect } = cds.test(__dirname + '/resources')
  test('datetime elements as key', async () => {
    let res
    const payload = { dt: '2020-12-31T01:02:03Z', int: 4711 }
    res = await INSERT.into('DateTimeEntity').entries(payload)
    res = await SELECT.one.from('DateTimeEntity').where({ dt: new Date(payload.dt).toISOString() })
    expect(res).to.containSubset(payload)
    res = await SELECT.one.from('DateTimeEntity').where({ dt: new Date(payload.dt) })
    expect(res).to.containSubset(payload)
    res = await SELECT.one.from('DateTimeEntity').where({ dt: payload.dt })
    expect(res).to.containSubset(payload)
  })

  // REVISIT: The test was not actually testing anything valid and the compiler doesn't do what we would expect
  test.skip('$now in view', async () => cds.tx(async tx => {
    const req_timestamp = new Date()
    await INSERT.into('TimestampEntity').entries({ ID: 1, ts: req_timestamp })
    const { now } = await SELECT.one.from('TimestampView')
    expect(now.match(/\.(\d\d\d)Z/)[1].match(/000/)).to.be.null //> check that we get ms precision
    expect(new Date(now) | 0).to.be.eq(tx.context.timestamp | 0)
  }))
})
