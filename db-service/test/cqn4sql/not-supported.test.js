// here we can collect features which are not (yet) supported
'use strict'
const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds')
const { expect } = cds.test
const _inferred = require('../../lib/infer')

describe('not supported features', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  it('does not transform queries with multiple query sources, but just returns the inferred query', () => {
    let query = cds.ql`SELECT from bookshop.Books, bookshop.Receipt`
    expect(cqn4sql(query, model)).to.deep.equal(_inferred(query, model))
    // .to.throw(/Queries with multiple query sources are not supported/)
  })

  it('rejects excessively nested expressions instead of overflowing the stack', () => {
    // deeply nested parens (e.g. crafted OData `$filter`) become nested `xpr`s
    let inner = { xpr: [{ ref: ['ID'] }, '=', { val: 1 }] }
    for (let i = 0; i < 3000; i++) inner = { xpr: [inner] }
    const query = cds.ql`SELECT from bookshop.Books`
    query.SELECT.where = [inner]
    expect(() => cqn4sql(query, model)).to.throw(/nesting depth/)
  })
})
