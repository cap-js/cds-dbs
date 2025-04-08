const cds = require('../../test/cds')

describe('Versioned table', () => {
  before(() => {
    // Include the versioning feature model extension
    cds.requires.toggles = true
  })

  const { expect } = cds.test(
    __dirname + '/../../test/compliance/resources',
    // Additional model definition is required, because feature flags don't work correctly without mtx
    __dirname + '/../../test/compliance/resources/fts/versioning/sqlite.cds'
  )

  before(async () => {
    // Deploy the versioning -> versioning.history triggers to fill associations
    await cds.run([
      `CREATE TRIGGER versioned_delete DELETE ON edge_hana_versioning_versioned
    FOR EACH ROW BEGIN
      INSERT INTO edge_hana_versioning_versioned_history (ID,validFrom,validTo,data) VALUES (old.ID,old.validFrom,session_context('$now'),old.data);
    END;`,
      `CREATE TRIGGER versioned_update UPDATE ON edge_hana_versioning_versioned
    FOR EACH ROW BEGIN
      INSERT INTO edge_hana_versioning_versioned_history (ID,validFrom,validTo,data) VALUES (old.ID,old.validFrom,session_context('$now'),old.data);
    END;`])
  })

  test('validation', async () => {
    const { versioned } = cds.entities('edge.hana.versioning')
    const { history } = cds.entities('edge.hana.versioning.versioned')

    const sel = SELECT.one`*, history[order by validFrom asc] {*}`.from(versioned)

    const ID = cds.utils.uuid()
    await cds.tx(() => INSERT([{ ID, data: 'original' }]).into(versioned))
    const org = await sel.clone()

    await cds.tx(() => UPSERT([{ ID, data: 'upserted' }]).into(versioned))
    await cds.tx(() => UPDATE(versioned).data({ data: 'updated' }).where({ ID }))
    const upd = await sel.clone()

    await DELETE(versioned)
    const del = await sel.clone()
    const his = await SELECT.from(history).orderBy('validFrom')

    expect(org).property('data').eq('original')
    expect(upd).property('data').eq('updated')
    expect(del).to.be.undefined

    expect(org).property('history').length(0)
    expect(upd).property('history').length(2)
    expect(upd).property('history').property('0').property('data').eq('original')
    expect(upd).property('history').property('1').property('data').eq('upserted')

    expect(his).length(3)

    // Time travel doesn't work in SQLite :(
  })

})