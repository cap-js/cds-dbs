// In general, structs are not allowed in an expression position.
// For convenience, we allow certain conditions involving structs, which
// are translated by respective conditions on the leave elements, combined with AND.

// (SMW) TODO move text from issue to here?

'use strict'

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds/lib')
const { expect } = cds.test

describe('compare structures', () => {
  // more structural comparisons in "assocs2joins.test.js"
  let model
  beforeAll(async () => {
    model = await cds.load(__dirname + '/../bookshop/db/schema.cds').then(cds.linked)
  })
  const { eqOps, notEqOps, notSupportedOps } = cqn4sql

  it('expand <nullEqOps> NULL with a managed association in where w/ parens', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.AssocWithStructuredKey { ID } where not AssocWithStructuredKey.toStructuredKey ${first} null`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.AssocWithStructuredKey as AssocWithStructuredKey { AssocWithStructuredKey.ID }
            where not (AssocWithStructuredKey.toStructuredKey_struct_mid_leaf ${first} null AND
                  AssocWithStructuredKey.toStructuredKey_struct_mid_anotherLeaf ${first} null AND
                  AssocWithStructuredKey.toStructuredKey_second ${first} null)`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })
  it('expand <nullEqOps> NULL with a managed association in where w/o parens', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.AssocWithStructuredKey { ID } where AssocWithStructuredKey.toStructuredKey ${first} null`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.AssocWithStructuredKey as AssocWithStructuredKey { AssocWithStructuredKey.ID }
            where AssocWithStructuredKey.toStructuredKey_struct_mid_leaf ${first} null AND
                  AssocWithStructuredKey.toStructuredKey_struct_mid_anotherLeaf ${first} null AND
                  AssocWithStructuredKey.toStructuredKey_second ${first} null`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })
  it('expand <nullEqOps> NULL with a managed association in having w/ parens', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.AssocWithStructuredKey { ID } having not AssocWithStructuredKey.toStructuredKey ${first} null`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.AssocWithStructuredKey as AssocWithStructuredKey { AssocWithStructuredKey.ID }
            having not (AssocWithStructuredKey.toStructuredKey_struct_mid_leaf ${first} null AND
                  AssocWithStructuredKey.toStructuredKey_struct_mid_anotherLeaf ${first} null AND
                  AssocWithStructuredKey.toStructuredKey_second ${first} null)`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })

  it('expand <nullNotEqOps> NULL with a managed association in where w/ parens', () => {
    notEqOps.forEach(op => {
      const [first, second] = op
      const queryString = `SELECT from bookshop.AssocWithStructuredKey { ID } where not AssocWithStructuredKey.toStructuredKey ${
        second ? first + ' ' + second : first
      } null`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.AssocWithStructuredKey as AssocWithStructuredKey { AssocWithStructuredKey.ID }
            where not (AssocWithStructuredKey.toStructuredKey_struct_mid_leaf ${
              second ? first + ' ' + second : first
            } null OR
                  AssocWithStructuredKey.toStructuredKey_struct_mid_anotherLeaf ${
                    second ? first + ' ' + second : first
                  } null OR
                  AssocWithStructuredKey.toStructuredKey_second ${second ? first + ' ' + second : first} null)`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })

  it('expand <operator> NULL with a managed association in having and omits xpr if possible', () => {
    eqOps.forEach(op => {
      const [first, second] = op
      const queryString = `SELECT from bookshop.Books { ID } having Books.author ${
        second ? first + ' ' + second : first
      } null`
      let query = cqn4sql(CQL(queryString), model)
      const expectedCQL = CQL(
        `SELECT from bookshop.Books as Books { Books.ID } having Books.author_ID ${
          second ? first + ' ' + second : first
        } null`,
      )
      expect(query).to.deep.equal(expectedCQL)
    })
  })

  // PB new
  // (SMW) my opinion: don't do - extra effort, no value
  it.skip('MUST expand <operator> NULL with a managed association in having if operands are flipped?', () => {
    eqOps.forEach(op => {
      const [first, second] = op
      const queryString = `SELECT from bookshop.Books { ID } having null ${
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
    let query = CQL`SELECT from bookshop.Books { ID } where (author.ID, 1) in ('foo', 'bar')`
    let expected = CQL`SELECT from bookshop.Books as Books { Books.ID } where (Books.author_ID, 1) in ('foo', 'bar')`
    expect(cqn4sql(query, model)).to.deep.equal(expected)
  })
  it('tuple list in where', () => {
    let query = CQL`SELECT from bookshop.Books { ID } where (author.ID, 1) in (('foo', 1), ('bar', 2))`
    let expected = CQL`SELECT from bookshop.Books as Books { Books.ID } where (Books.author_ID, 1) in (('foo', 1), ('bar', 2))`
    expect(cqn4sql(query, model)).to.deep.equal(expected)
  })
  it('list in having', () => {
    let query = CQL`SELECT from bookshop.Books { ID } having (author.ID, 1) in ('foo', 'bar')`
    let expected = CQL`SELECT from bookshop.Books as Books { Books.ID } having (Books.author_ID, 1) in ('foo', 'bar')`
    expect(cqn4sql(query, model)).to.deep.equal(expected)
  })

  it('”IS / <> NULL” comparison with a managed association with two FKs', () => {
    // `IS NULL` concat with "and"
    // `<> NULL` concat with "or"
    let query = cqn4sql(
      CQL`SELECT from bookshop.AssocWithStructuredKey as AWSK { ID } where 1<2 and toStructuredKey is null or 2<3 or toStructuredKey <> null`,
      model,
    )
    expect(query).to.deep.equal(CQL`SELECT from bookshop.AssocWithStructuredKey as AWSK { AWSK.ID }
        where 1<2
          and (AWSK.toStructuredKey_struct_mid_leaf is null
          and AWSK.toStructuredKey_struct_mid_anotherLeaf is null
          and AWSK.toStructuredKey_second is null)
          or 2<3
          or (AWSK.toStructuredKey_struct_mid_leaf <> null
          or AWSK.toStructuredKey_struct_mid_anotherLeaf <> null
          or AWSK.toStructuredKey_second <> null)`)
  })

  it('IS NULL comparison with a structure', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Bar { ID } where Bar.structure is null`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Bar as Bar {Bar.ID}
          where (Bar.structure_foo is null
            and Bar.structure_baz is null)`)
  })

  it('<operator> NULL comparison with a managed association in column list', () => {
    eqOps.forEach(op => {
      const [first, second] = op
      const queryString = `SELECT from bookshop.Books {
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
      const queryString = `SELECT from bookshop.AssocWithStructuredKey { ID } where not AssocWithStructuredKey.toStructuredKey ${first} null`
      expect(() => cqn4sql(CQL(queryString), model)).to.throw(
        `The operator "${first}" is not supported for structure comparison`,
      )
    })
  })
})
