// In general, structs are not allowed in an expression position.
// For convenience, we allow certain conditions involving structs, which
// are translated by respective conditions on the leave elements, combined with AND.

// (SMW) TODO move text from issue to here?

'use strict'

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds')
const { expect } = cds.test

describe('compare structures', () => {
  // more structural comparisons in "assocs2joins.test.js"
  let model
  beforeAll(async () => {
    model = await cds.load(__dirname + '/../bookshop/db/schema.cds').then(cds.linked)
  })
  const { eqOps, notEqOps, notSupportedOps } = cqn4sql


  })

  // PB new
  // (SMW) my opinion: don't do - extra effort, no value
  it.skip('MUST expand <operator> NULL with a managed association in having if operands are flipped?', () => {
    eqOps.forEach(op => {
      const [first, second] = op
      const queryString = `SELECT from bookshop.Books as Books { ID } having null ${
        second ? first + ' ' + second : first
      } Books.author`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `SELECT from bookshop.Books as Books { Books.ID } having null ${
        second ? first + ' ' + second : first
      } Books.author_ID`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })

  it('list in where', () => {
    let query = cds.ql`SELECT from bookshop.Books as Books { ID } where (author.ID, 1) in ('foo', 'bar')`
    let expected = cds.ql`SELECT from bookshop.Books as Books { Books.ID } where (Books.author_ID, 1) in ('foo', 'bar')`
    expect(cqn4sql(query, model)).to.deep.equal(expected)
  })
  it('tuple list in where', () => {
    let query = cds.ql`SELECT from bookshop.Books as Books { ID } where (author.ID, 1) in (('foo', 1), ('bar', 2))`
    let expected = cds.ql`SELECT from bookshop.Books as Books { Books.ID } where (Books.author_ID, 1) in (('foo', 1), ('bar', 2))`
    expect(cqn4sql(query, model)).to.deep.equal(expected)
  })
  it('list in having', () => {
    let query = cds.ql`SELECT from bookshop.Books as Books { ID } having (author.ID, 1) in ('foo', 'bar')`
    let expected = cds.ql`SELECT from bookshop.Books as Books { Books.ID } having (Books.author_ID, 1) in ('foo', 'bar')`
    expect(cqn4sql(query, model)).to.deep.equal(expected)
  })



  it('<operator> NULL comparison with a managed association in column list', () => {
    eqOps.forEach(op => {
      const [first, second] = op
      const queryString = `SELECT from bookshop.Books as Books {
          ID,
          case when not author ${second ? first + ' ' + second : first} null then 'hit' end as c
        }`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `SELECT from bookshop.Books as Books {
          Books.ID,
          case when not (Books.author_ID ${second ? first + ' ' + second : first} null) then 'hit' end as c
        }`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })

  it('issues a proper error for operators which are not supported', () => {
    notSupportedOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.AssocWithStructuredKey as AssocWithStructuredKey { ID } where not AssocWithStructuredKey.toStructuredKey ${first} null`
      expect(() => cqn4sql(CQL(queryString), model)).to.throw(
        `The operator "${first}" can only be used with scalar operands`,
      )
    })
  })
})
