/**
 * Make sure we issue proper errors in case of path expression along keyless entities
 */
'use strict'

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds')
const { expect } = cds.test
describe('keyless entities', () => {
  let model

  beforeAll(async () => {
    model = await cds.load(__dirname + '/model/keyless').then(cds.linked)
  })

  it('no foreign keys for join', () => {
    const { Books } = model.entities
    const q = SELECT.from(Books).where(`author[ID = 42].book[ID = 42].author.name LIKE 'King'`)
    expect(() => cqn4sql(q, model)).to.throw(
      'Path step “author” of “author[…].book[…].author.name” has no valid foreign keys',
    )
    const qOk = SELECT.columns('ID').from(Books).where(`authorWithExplicitForeignKey[ID = 42].name LIKE 'King'`)
    expect(cqn4sql(qOk, model)).to.eql(
      CQL`SELECT Books.ID FROM Books as Books 
        left join Authors as authorWithExplicitForeignKey
          on authorWithExplicitForeignKey.ID = Books.authorWithExplicitForeignKey_ID
          and authorWithExplicitForeignKey.ID = 42
        where authorWithExplicitForeignKey.name LIKE 'King'`,
    )
  })

  it.skip('scoped query leading to where exists subquery cant be constructed', () => {
    const q = SELECT.from('Books:author')
    expect(() => cqn4sql(q, model)).to.throw()
  })
  it.skip('where exists predicate cant be transformed to subquery', () => {
    const q = SELECT.from('Books').where('exists author')
    expect(() => cqn4sql(q, model)).to.throw()
  })
  it.skip('correlated subquery for expand cant be constructed', () => {
    const q = CQL`SELECT author { name } from Books`
    expect(() => cqn4sql(q, model)).to.throw()
  })
})
