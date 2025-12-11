const cds = require('../../test/cds')

describe('Versioned table', () => {
  before(() => {
    // Include the versioning feature model extension
    // cds.requires.toggles = true
  })

  const { expect } = cds.test(
    __dirname + '/../../test/compliance/resources',
    // cds.requires.toggles now works as expected, but it doesn't distinguished between implementations
    __dirname + '/../../test/compliance/resources/fts/versioning/hana.cds'
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
  })

  test('hana server version', () => {
    // 2 hana express, 4 hana cloud
    expect(cds.db.server.major).to.be.at.least(2)
  })
})