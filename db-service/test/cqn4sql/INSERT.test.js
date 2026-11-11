// not much to do for cqn4sql in case of INSERT/UPSERT
'use strict'
const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds')
const { expect } = cds.test
const freezeData = require('./helpers/freezeData')

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

  for (const kind of ['INSERT', 'UPSERT']) {
    for (const property of ['entries', 'rows']) {
      it('preserves ' + kind + '.' + property + ' without traversing it', () => {
        const payload = new Proxy([], { ownKeys() { throw new Error('payload traversed') } })
        const input = Object.freeze({
          [kind]: Object.freeze({ into: freezeData({ ref: ['bookshop.Books', 'author'] }), [property]: payload }),
        })
        const result = cqn4sql(input, model)
        expect(result[kind].into).to.deep.equal({ ref: ['bookshop.Authors'] })
        expect(result[kind][property]).to.equal(payload)
        expect(result).not.to.equal(input)
      })
    }
  }

  it('preserves generator entries without consuming them', () => {
    let consumed = false
    const entries = (function* () {
      consumed = true
      yield { ID: 1 }
    })()
    const input = freezeData({ INSERT: { into: { ref: ['bookshop.Books'] }, entries } })
    const result = cqn4sql(input, model)
    expect(result.INSERT.into).to.deep.equal({ ref: ['bookshop.Books'] })
    expect(result.INSERT.entries).to.equal(entries)
    expect(consumed).to.equal(false)
  })
})
