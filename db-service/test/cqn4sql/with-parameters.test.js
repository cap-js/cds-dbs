/**
 * Make sure cqn4sql always works on a copy of the incoming query, enabling
 * extension scenarios and repetitive calls.
 */
'use strict'

const { SELECT } = require('@sap/cds/lib/ql/cds-ql')
const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds/lib')
const { expect } = cds.test
describe('Repetitive calls to cqn4sql must work', () => {
  let model
  beforeAll(async () => {
    model = await cds.load(__dirname + '/model/withParameters').then(cds.linked)
  })

  it('select from view with param', () => {
    const query = cqn4sql(SELECT.from('PBooks(P1: 1, P2: 2)').columns('ID'), model)
    const expected = SELECT.from('PBooks(P1: 1, P2: 2) as PBooks').columns('PBooks.ID')
    expect(query).to.deep.equal(expected)
  })
  // will be done in another change
  it.skip('select from view with param and join with normal entity', () => {
    // currently only possible with cds-compiler beta-mode,
    // as the view with params does not yet support associations
    const query = cqn4sql(SELECT.from('PBooks(P1: 1, P2: 2)').columns('author.name as author'), model)
    const expected = CQL`SELECT FROM PBooks(P1: 1, P2: 2) as PBooks
                         left join Authors as author on author.ID = PBooks.author_ID {
                          author.name as author
                         }`
    expect(query).to.deep.equal(expected)
  })
})
