'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

const { expect } = cds.test

let cqn4sql = require('../../../lib/cqn4sql')
const { eqOps, notEqOps, notSupportedOps } = cqn4sql

describe('compare a structure', () => {
  before(async () => {
    const m = await loadModel()
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, m)
  })

  describe('with a value', () => {})

  describe('with another structure', () => {})

  // concat leaf comparisons with `AND`, if negated with parens
  describe('equality operators with NULL', () => {
    it('multiple leafs', () => {
      eqOps.forEach(op => {
        const [first] = op
        const transformed = cqn4sql(
          cds.ql(
            `SELECT from bookshop.AssocWithStructuredKey as AssocWithStructuredKey { ID } where AssocWithStructuredKey.toStructuredKey ${first} null`,
          ),
        )
        const expected = cds.ql(`
          SELECT from bookshop.AssocWithStructuredKey as AssocWithStructuredKey { AssocWithStructuredKey.ID }
            where AssocWithStructuredKey.toStructuredKey_struct_mid_leaf ${first} null AND
                  AssocWithStructuredKey.toStructuredKey_struct_mid_anotherLeaf ${first} null AND
                  AssocWithStructuredKey.toStructuredKey_second ${first} null`)
        expectCqn(transformed).to.equal(expected)
      })
    })

    it('negated null comparison needs parens for multiple leafs', () => {
      eqOps.forEach(op => {
        const [first] = op
        const transformed = cqn4sql(
          cds.ql(
            `SELECT from bookshop.AssocWithStructuredKey as AssocWithStructuredKey { ID }
              where not AssocWithStructuredKey.toStructuredKey ${first} null`,
          ),
        )
        const expected = cds.ql(`
              SELECT from bookshop.AssocWithStructuredKey as AssocWithStructuredKey { AssocWithStructuredKey.ID }
                where not (AssocWithStructuredKey.toStructuredKey_struct_mid_leaf ${first} null AND
                      AssocWithStructuredKey.toStructuredKey_struct_mid_anotherLeaf ${first} null AND
                      AssocWithStructuredKey.toStructuredKey_second ${first} null)`)
        expectCqn(transformed).to.equal(expected)
      })
    })

    it('negated null comparison needs parens for multiple leafs (having)', () => {
      eqOps.forEach(op => {
        const [first] = op
        const transformed = cqn4sql(
          cds.ql(
            `SELECT from bookshop.AssocWithStructuredKey as AssocWithStructuredKey { ID } having not AssocWithStructuredKey.toStructuredKey ${first} null`,
          ),
        )
        const expected = cds.ql(`
              SELECT from bookshop.AssocWithStructuredKey as AssocWithStructuredKey { AssocWithStructuredKey.ID }
                having not (AssocWithStructuredKey.toStructuredKey_struct_mid_leaf ${first} null AND
                      AssocWithStructuredKey.toStructuredKey_struct_mid_anotherLeaf ${first} null AND
                      AssocWithStructuredKey.toStructuredKey_second ${first} null)`)
        expectCqn(transformed).to.equal(expected)
      })
    })

    it('no need for parens if there is only one leaf', () => {
      eqOps.forEach(op => {
        const [first, second] = op
        const transformed = cqn4sql(
          cds.ql(
            `SELECT from bookshop.Books as Books { ID } having Books.author ${
              second ? first + ' ' + second : first
            } null`,
          ),
        )
        const expected = cds.ql(
          `SELECT from bookshop.Books as Books { Books.ID } having Books.author_ID ${
            second ? first + ' ' + second : first
          } null`,
        )
        expectCqn(transformed).to.equal(expected)
      })
    })

    it('there is a need for parens if there is only one leaf and additional condition', () => {
      eqOps.forEach(op => {
        const [first, second] = op
        const transformed = cqn4sql(
          cds.ql(
            `SELECT from bookshop.Books as Books { ID } having Books.author ${
              second ? first + ' ' + second : first
            } null and 1 = 1`,
          ),
        )
        const expected = cds.ql(
          `SELECT from bookshop.Books as Books { Books.ID } having (Books.author_ID ${
            second ? first + ' ' + second : first
          } null) and 1 = 1`,
        )
        expectCqn(transformed).to.equal(expected)
      })
    })

    it('IS NULL comparison with a structure', () => {
      // already tested above, but keeping it for clarity
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Bar as Bar { ID } where Bar.structure is null`)
      const expected = cds.ql`
        SELECT from bookshop.Bar as Bar {Bar.ID}
              where (Bar.structure_foo is null
                and Bar.structure_baz is null)`
      expectCqn(transformed).to.equal(expected)
    })

    it('IS NULL comparison in a case … when … expression', () => {
      eqOps.forEach(op => {
        const [first, second] = op
        const transformed = cqn4sql(
          cds.ql(`SELECT from bookshop.Books as Books {
              ID,
              case when not author ${second ? first + ' ' + second : first} null then 'hit' end as c
            }`),
        )
        const expected = cds.ql(`SELECT from bookshop.Books as Books {
              Books.ID,
              case when not (Books.author_ID ${second ? first + ' ' + second : first} null) then 'hit' end as c
            }`)
        expectCqn(transformed).to.equal(expected)
      })
    })
  })

  // concat leaf comparisons with `OR`, if negated with parens
  // TODO: there could be more tests
  describe('inequality operators with NULL', () => {
    it('multiple leafs', () => {
      notEqOps.forEach(op => {
        const [first, second] = op
        const transformed = cqn4sql(
          cds.ql(
            `SELECT from bookshop.AssocWithStructuredKey as AssocWithStructuredKey { ID } where not AssocWithStructuredKey.toStructuredKey ${
              second ? first + ' ' + second : first
            } null`,
          ),
        )
        const expected = cds.ql(`
          SELECT from bookshop.AssocWithStructuredKey as AssocWithStructuredKey { AssocWithStructuredKey.ID }
            where not (AssocWithStructuredKey.toStructuredKey_struct_mid_leaf ${
              second ? first + ' ' + second : first
            } null OR
            AssocWithStructuredKey.toStructuredKey_struct_mid_anotherLeaf ${
              second ? first + ' ' + second : first
            } null OR
            AssocWithStructuredKey.toStructuredKey_second ${second ? first + ' ' + second : first} null)`)
        expectCqn(transformed).to.equal(expected)
      })
    })
    it('mixed equality and inequality', () => {
      // `IS NULL` concat with "and"
      // `<> NULL` concat with "or"
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.AssocWithStructuredKey as AWSK { ID } where 1<2 and toStructuredKey is null or 2<3 or toStructuredKey <> null`)
      const expected = cds.ql`
        SELECT from bookshop.AssocWithStructuredKey as AWSK { AWSK.ID }
            where 1<2
              and (AWSK.toStructuredKey_struct_mid_leaf is null
              and AWSK.toStructuredKey_struct_mid_anotherLeaf is null
              and AWSK.toStructuredKey_second is null)
              or 2<3
              or (AWSK.toStructuredKey_struct_mid_leaf <> null
              or AWSK.toStructuredKey_struct_mid_anotherLeaf <> null
              or AWSK.toStructuredKey_second <> null)`
      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('operators not supported with structures', () => {
    it('issues a proper error', () => {
      notSupportedOps.forEach(op => {
        const [first] = op
        expect(() =>
          cqn4sql(
            cds.ql(
              `SELECT from bookshop.AssocWithStructuredKey as AssocWithStructuredKey { ID } where not AssocWithStructuredKey.toStructuredKey ${first} null`
            )
          )
        ).to.throw(`The operator "${first}" can only be used with scalar operands`)
      })
    })
    
  })
})
