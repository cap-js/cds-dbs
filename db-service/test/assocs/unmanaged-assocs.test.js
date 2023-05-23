/* eslint-disable no-console */
const cds = require('@sap/cds/lib')
require('../../index') // to extend cds.ql query objects with .forSQL() and alike

describe('where exists assoc', () => {
  it('should work with managed assocs', async () => {
    cds.model = await cds.load(__dirname + '/schema1').then(cds.linked)
    const { Books, Authors } = cds.model.entities
    let qb = SELECT.from(Books).where('exists author').forSQL()
    let qa = SELECT.from(Authors).where('exists books').forSQL()
    console.log(qa)
    console.log(qb)
  })

  it('should work with unmanaged assocs', async () => {
    cds.model = await cds.load(__dirname + '/schema2').then(cds.linked)
    const { Books, Authors } = cds.model.entities
    let qb = SELECT.from(Books).where('exists author').forSQL()
    let qa = SELECT.from(Authors).where('exists books').forSQL()
    // let qx = q.forSQL() // FAILS with:
    /*
      TypeError: Cannot read properties of undefined (reading 'map')

      880 |       // for unmanaged associations, replace name of association (on target side of on condition) with explicit table alias
      881 |       // REVISIT: where not exists SiblingEntity -> definition is the source entity, not the assoc
    > 882 |       on.push(...definition.on.map((t) => {
          |                                ^
      883 |         if(t.ref?.length > 1 && t.ref[0] === definition.name)
      884 |           return {ref: [current.alias, ...t.ref.slice(1)]}
      885 |         else

      at map (cds-sqlite/lib/db/sql/cqn4sql.js:882:32)
      at getWhereExistsSubquery (cds-sqlite/lib/db/sql/cqn4sql.js:398:38)
      at Function.getTransformedTokenStream [as cqn4sql] (cds-sqlite/lib/db/sql/cqn4sql.js:55:31)
      at Query.cqn4sql [as forSQL] (cds-sqlite/cds/index.js:7:60)
      at Object.forSQL (cds-sqlite/test/unmanaged-assocs/unmanaged-assocs.test.js:12:16)
    */
    console.log(JSON.stringify(qb, null, 2))
    console.log(JSON.stringify(qa, null, 2))
  })
})
