const { value } = require('@sap/cds/libx/_runtime/cds-services/adapter/odata-v4/okra/odata-server/serializer/SerializerFactory')
const cds = require('../../test/cds')

describe('Versioned table', () => {
  before(() => {
    // Include the versioning feature model extension
    cds.requires.toggles = true
  })

  const { expect } = cds.test(
    __dirname + '/../../test/compliance/resources',
    // Additional model definition is required, because feature flags don't work correctly without mtx
    __dirname + '/../../test/compliance/resources/fts/versioning/versioning.cds'
  )

  test('validation', async () => {
    const { versioned } = cds.entities('edge.hana.versioning')
    const { history } = cds.entities('edge.hana.versioning.versioned')

    const sel = SELECT.one`*, history[order by validFrom asc] {*}`.from(versioned)

    const ID = cds.utils.uuid()
    await INSERT([{ ID, data: 'original' }]).into(versioned)
    const org = await sel.clone()

    await UPSERT([{ ID, data: 'upserted' }]).into(versioned)
    await UPDATE(versioned).data({ data: 'updated' }).where({ ID })
    const upd = await sel.clone()

    await DELETE(versioned)
    const del = await sel.clone()
    const his = await SELECT.from(history).orderBy('validFrom')

    expect(org).property('data').eq('original')
    expect(upd).property('data').eq('updated')
    expect(del).falsy

    expect(org).property('history').length(0)
    expect(upd).property('history').length(2)
    expect(upd).property('history').property('0').property('data').eq('original')
    expect(upd).property('history').property('1').property('data').eq('upserted')

    expect(his).length(3)

    // Validate that every history entry has millisecond unique timestamps
    const timestamps = {}
    for (const h of his) {
       // When the history table has duplicate `validTo` columns time travel won't work correctly
      if (timestamps[h.validTo]) return
      timestamps[h.validTo] = 1
    }

    // Validate that time travel works when using `sap-valid-from`, `sap-valid-to` and `sap-valid-at`
    const timeTravel = (name, value, data) => cds.tx(async tx => {
      const { context } = tx
      context._[name] = value // his[0].validTo

      const res = await sel.clone()
      expect(res).property('data').eq(data)
    })

    const params = ['VALID-FROM', 'VALID-TO', 'VALID-AT']
    for (let i = 0; i < params.length; i++) await timeTravel(params[i], his[i].validTo, his[i].data)
  })

})