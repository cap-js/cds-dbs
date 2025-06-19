// here we can collect features which are not (yet) supported
'use strict'
import cqn4sql from '../../lib/cqn4sql.js'
import cds from '@sap/cds'
import { expect } from cds.test
import _inferred from '../../lib/infer.js'

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
})
