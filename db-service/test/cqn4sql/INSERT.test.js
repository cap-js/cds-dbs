// not much to do for cqn4sql in case of INSERT/UPSERT
'use strict'
import cqn4sql from '../../lib/cqn4sql.js'
import cds from '@sap/cds'
const { expect } = cds.test

describe('INSERT', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })
  it('simple', () => {
    let i = INSERT.into('bookshop.Books')
    const query = cqn4sql(i, model)
    expect(query.INSERT.into).to.deep.equal({ ref: ['bookshop.Books'] })
  })
  it('path expression in into clause', () => {
    let i = INSERT.into('bookshop.Books:author')
    const query = cqn4sql(i, model)
    expect(query.INSERT.into).to.deep.equal({ ref: ['bookshop.Authors'] })
  })
  it('path expression in into clause with alias', () => {
    let i = {
      INSERT: {
        into: { ref: ['bookshop.Books', 'author'], as: 'Foo' },
      },
    }
    const result = cqn4sql(i, model)
    expect(result.INSERT.into).to.deep.equal({ ref: ['bookshop.Authors'], as: 'Foo' })
  })
  it('path expression in into clause with UPSERT', () => {
    let upsert = UPSERT.into('bookshop.Books:author')
    const result = cqn4sql(upsert, model)
    expect(result.UPSERT.into).to.deep.equal({ ref: ['bookshop.Authors'] })
  })
})
