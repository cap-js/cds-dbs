/**
 * Make sure cqn4sql always works on a copy of the incoming query, enabling
 * extension scenarios and repetitive calls.
 */
'use strict'

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds')
const { expect } = cds.test
const { expectCqn } = require('./helpers/expectCqn')
const freezeData = require('./helpers/freezeData')
describe('Repetitive calls to cqn4sql must work', () => {
  let model
  beforeAll(async () => {
    model = freezeData(await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked))
  })

  it('query can be extended by another element', () => {
    const original = cds.ql`SELECT from bookshop.Books as Books { ID }`
    let query = cqn4sql(original, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books { Books.ID }`)
    original.SELECT.columns.push({ ref: ['title'] })
    query = cqn4sql(original, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books { Books.ID, Books.title }`)
    original.SELECT.where = ['exists', { ref: ['author'] }]
    query = cqn4sql(original, model)
    expect(query).to.deep.equal(
      cds.ql`
      SELECT from bookshop.Books as Books
      { Books.ID, Books.title }
      WHERE EXISTS (
        SELECT 1 from bookshop.Authors as $a where $a.ID = Books.author_ID
      )
     `,
    )
  })

  it('accepts empty select list', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { }`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books { }`)
  })

  it('yields the same result if same query is transformed multiple times', () => {
    const input = freezeData(cds.ql`SELECT from bookshop.Books:author`)
    let query = cqn4sql(input, model)
    let query2 = cqn4sql(input, model)
    expect(query).to.deep.equal(query2)
  })
  it('yields the same result if same query is transformed multiple times (2)', () => {
    const input = freezeData(cds.ql`SELECT from bookshop.Books where author.name like '%Poe'`)
    let query = cqn4sql(input, model)
    let query2 = cqn4sql(input, model)
    expect(query2).to.deep.equal(query)
  })

  it('preserves extension accessors without evaluating them during transformation', () => {
    const input = cds.ql`SELECT from bookshop.Books as Books { ID }`
    let reads = 0
    const getter = () => {
      reads++
      return 'metadata'
    }
    Object.defineProperty(input, 'extension', { enumerable: true, get: getter })
    const result = cqn4sql(freezeData(input), model)
    expect(reads).to.equal(0)
    expect(result.extension).to.equal('metadata')
    expect(reads).to.equal(1)
    expectCqn({ SELECT: result.SELECT }).to.equal(cds.ql`SELECT from bookshop.Books as Books { Books.ID }`)
  })

  it('owns inherited query clauses independently of the original', () => {
    const base = freezeData(cds.ql`SELECT from bookshop.Books as Books { ID } where ID = 1`)
    const input = freezeData(cds.ql.clone(base))
    const result = cqn4sql(input, model)
    expectCqn(result).to.equal(cds.ql`SELECT from bookshop.Books as Books { Books.ID } where Books.ID = 1`)
    result.SELECT.where[2].val = 2
    expect(base.SELECT.where[2].val).to.equal(1)
    expectCqn(cqn4sql(input, model)).to.equal(cds.ql`SELECT from bookshop.Books as Books { Books.ID } where Books.ID = 1`)
  })

  it('emits runtime-view CTEs without modifying frozen view definitions', () => {
    const runtimeModel = freezeData(cds.linked(cds.compile(`
      entity Books { key ID: Integer; title: String; content: LargeBinary; }
      @cds.persistence.skip entity AvailableBooks as select from Books { * };
    `)))
    const input = freezeData(cds.ql`SELECT from AvailableBooks as B { ID, title }`)
    const feature = cds.env.features.runtime_views
    cds.env.features.runtime_views = true
    try {
      const result = cqn4sql(input, runtimeModel)
      const view = cds.ql`
        SELECT from Books as $B { $B.ID, $B.title, $B.content }
      `
      view.as = 'RTV_$A'
      const expected = cds.ql`SELECT from RTV_$A as B { B.ID, B.title }`
      expected._with = [view]
      expectCqn(result).to.equal(expected)
      expectCqn(cqn4sql(input, runtimeModel)).to.equal(expected)
    } finally {
      cds.env.features.runtime_views = feature
    }
  })
})
