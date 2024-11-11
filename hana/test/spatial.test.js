const cds = require('../../test/cds.js')

describe('Spatial Types', () => {
  const { data, expect } = cds.test(__dirname + '/../../test/compliance/resources')
  data.autoIsolation(true)
  data.autoReset()

  test('point', async () => {
    const { HANA_ST } = cds.entities('edge.hana.literals')
    const point = 'POINT(1 1)'
    await INSERT({ point: null }).into(HANA_ST)
    await UPDATE(HANA_ST).data({ point })
    const result = await SELECT.one.from(HANA_ST)
    expect(result.point).to.contain('POINT')
  })

  test('geometry', async () => {
    const { HANA_ST } = cds.entities('edge.hana.literals')
    const geometry = 'POINT(1 1)'
    await INSERT({ geometry: null }).into(HANA_ST)
    await UPDATE(HANA_ST).data({ geometry })
    const result = await SELECT.one.from(HANA_ST)
    expect(result.geometry).to.contain('POINT')
  })
})
