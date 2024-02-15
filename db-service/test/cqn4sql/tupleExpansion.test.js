'use strict'

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds/lib')
const { expect } = cds.test
// TODO test for unsupported comparison ops
describe('Structural comparison', () => {
  let model
  beforeAll(async () => {
    model = await cds.load(__dirname + '/../bookshop/db/schema.cds').then(cds.linked)
  })

  let { eqOps, notEqOps } = cqn4sql
  eqOps = eqOps.filter(op => {
    const [first] = op
    return first.toUpperCase() !== 'IS' // `IS` -> must be followed by (not) null
  })
  notEqOps = notEqOps.filter(op => {
    const [first] = op
    return first.toUpperCase() !== 'IS' // `IS NOT` -> must be followed by null
  })

  it('compare scalar leaf with value', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.Books { ID } where dedication.text ${first} 'for mommy'`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.Books as Books { Books.ID }
            where Books.dedication_text ${first} 'for mommy'`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })
  it('compare scalar (join relevant) leaf with value', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.Books { ID } where dedication.addressee.name ${first} 'mommy'`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.Books as Books
                left outer join bookshop.Person as addressee on addressee.ID = Books.dedication_addressee_ID
            { Books.ID }
            where addressee.name ${first} 'mommy'`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })

  it('expand struct1 <structEqOps> struct2 in where w/ parens', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.EStruc { ID } where not struc1 ${first} struc2`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.EStruc as EStruc { EStruc.ID }
            where not (EStruc.struc1_foo ${first} EStruc.struc2_foo AND
                       EStruc.struc1_bar ${first} EStruc.struc2_bar)`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })

  // TODO (SMW) use assocs with 2 FKs
  it('expand assoc1 <structEqOps> assoc2 in where w/ parens', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.Books { ID } where not author ${first} coAuthor`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.Books as Books { Books.ID }
            where not (Books.author_ID ${first} Books.coAuthor_ID)`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })

  it('expand struct1 <structEqOps> struct2 in where w/o parens', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.EStruc { ID } where struc1 ${first} struc2`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.EStruc as EStruc { EStruc.ID }
            where EStruc.struc1_foo ${first} EStruc.struc2_foo AND
                       EStruc.struc1_bar ${first} EStruc.struc2_bar`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })

  it('expand assoc1 <structEqOps> assoc2 in where w/o parens', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.Books { ID } where author ${first} coAuthor`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.Books as Books { Books.ID }
            where Books.author_ID ${first} Books.coAuthor_ID`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })

  it('expand struct1 <structNotEqOps> struct2 in where w/o parens', () => {
    notEqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.EStruc { ID } where struc1 ${first} struc2`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.EStruc as EStruc { EStruc.ID }
            where EStruc.struc1_foo ${first} EStruc.struc2_foo OR
                  EStruc.struc1_bar ${first} EStruc.struc2_bar`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })

  it('expand aoosc1 <structNotEqOps> assoc2 in where w/o parens', () => {
    notEqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.Books { ID } where author ${first} coAuthor`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.Books as Books { Books.ID }
            where Books.author_ID ${first} Books.coAuthor_ID`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })

  it('expand struct1 <structNotEqOps> struct2 in where w/ parens', () => {
    notEqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.EStruc { ID } where struc1 ${first} struc2 and 1 = 1`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.EStruc as EStruc { EStruc.ID }
            where (EStruc.struc1_foo ${first} EStruc.struc2_foo OR
                   EStruc.struc1_bar ${first} EStruc.struc2_bar) AND 1 = 1`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })

  it('expand assoc1 <structNotEqOps> assoc2 in where w/ parens', () => {
    notEqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.Books { ID } where author ${first} coAuthor and 1 = 1`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.Books as Books { Books.ID }
            where (Books.author_ID ${first} Books.coAuthor_ID) AND 1 = 1`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })

  it('expand struc2Reversed <structEqOps> struct2 in where w/o parens (order should not matter)', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.EStruc { ID } where struc2Reversed ${first} struc2`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.EStruc as EStruc { EStruc.ID }
            where EStruc.struc2Reversed_bar ${first} EStruc.struc2_bar AND
                  EStruc.struc2Reversed_foo ${first} EStruc.struc2_foo`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })
  it('compare nested struct', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.Foo { ID } where stru.nested ${first} stru.nested`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.Foo as Foo { Foo.ID }
            where Foo.stru_nested_nu ${first} Foo.stru_nested_nu`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })

  it('compare assocs with complex FK (1)', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.AssocMaze1 as AM { ID }
          where a_strucX ${first} a_strucX`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.AssocMaze1 as AM { AM.ID }
            where AM.a_strucX_a ${first} AM.a_strucX_a
              and AM.a_strucX_b ${first} AM.a_strucX_b`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })

  it('compare assocs with complex FK (2)', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.AssocMaze1 as AM { ID }
          where a_strucY ${first} a_strucY`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.AssocMaze1 as AM { AM.ID }
            where AM.a_strucY_S_1_a ${first} AM.a_strucY_S_1_a
              and AM.a_strucY_S_1_b ${first} AM.a_strucY_S_1_b
              and AM.a_strucY_S_2_a ${first} AM.a_strucY_S_2_a
              and AM.a_strucY_S_2_b ${first} AM.a_strucY_S_2_b`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })

  // It is possible to compare structs with assocs, given they have the same elems/FKs
  it('compare struct with assoc (1)', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.AssocMaze1 as AM { ID }
          where a_strucX ${first} strucX`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.AssocMaze1 as AM { AM.ID }
            where AM.a_strucX_a ${first} AM.strucX_a
              and AM.a_strucX_b ${first} AM.strucX_b
          `
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })
  // TODO (SMW) - should work ...
  it('compare struct with assoc (2)', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.AssocMaze1 as AM { ID }
          where a_strucY ${first} strucY`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.AssocMaze1 as AM { AM.ID }
            where AM.a_strucY_S_1_a ${first} AM.strucY_S_1_a
              and AM.a_strucY_S_1_b ${first} AM.strucY_S_1_b
              and AM.a_strucY_S_2_a ${first} AM.strucY_S_2_a
              and AM.a_strucY_S_2_b ${first} AM.strucY_S_2_b
          `
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })

  it('compare struct with struct via assoc', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.EStrucSibling { ID }
          where EStrucSibling.struc2 ${first} EStrucSibling.self.struc2`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.EStrucSibling as EStrucSibling
                 left outer join bookshop.EStrucSibling as self on self.ID = EStrucSibling.self_ID
          { EStrucSibling.ID }
            where EStrucSibling.struc2_foo ${first} self.struc2_foo and
                  EStrucSibling.struc2_bar ${first} self.struc2_bar`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })

  it('compare nested assocs', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.DeepRecursiveAssoc { ID } where one ${first} one`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.DeepRecursiveAssoc as DeepRecursiveAssoc { DeepRecursiveAssoc.ID }
            where DeepRecursiveAssoc.one_two_three_toSelf_ID ${first} DeepRecursiveAssoc.one_two_three_toSelf_ID`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })

  it('expands comparison also in exists subquery', () => {
    const queryString = `SELECT from bookshop.AssocWithStructuredKey[toStructuredKey = null]:accessGroup { ID }`
    let query = cqn4sql(CQL(queryString), model)
    const expectedQueryString = `
        SELECT from bookshop.AccessGroups as accessGroup
        { accessGroup.ID }
        where exists (
          SELECT 1 from bookshop.AssocWithStructuredKey as AssocWithStructuredKey
          where AssocWithStructuredKey.accessGroup_ID = accessGroup.ID and
              AssocWithStructuredKey.toStructuredKey_struct_mid_leaf        = null and
              AssocWithStructuredKey.toStructuredKey_struct_mid_anotherLeaf = null and
              AssocWithStructuredKey.toStructuredKey_second                 = null
        )
      `
    expect(query).to.deep.equal(CQL(expectedQueryString))
  })

  it('compare assocs with multiple keys', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.AssocWithStructuredKey as AWSK { ID } where toStructuredKey ${first} toStructuredKey`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.AssocWithStructuredKey as AWSK { AWSK.ID }
            where AWSK.toStructuredKey_struct_mid_leaf        ${first} AWSK.toStructuredKey_struct_mid_leaf
              and AWSK.toStructuredKey_struct_mid_anotherLeaf ${first} AWSK.toStructuredKey_struct_mid_anotherLeaf
              and AWSK.toStructuredKey_second                 ${first} AWSK.toStructuredKey_second`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })

  it('proper error struct1 <structEqOps> struct2 with same leaf names but with different paths', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.EStrucSibling { ID } where not struc1 ${first} struc2`
      const expectedError = 'Can\'t compare "struc1" with "struc2": the operands must have the same structure'
      expect(() => cqn4sql(CQL(queryString), model)).to.throw(expectedError)
    })
  })

  it('proper error if structures cannot be compared', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.EStruc { ID } where not struc1 ${first} struc3`
      const expectedError = 'Can\'t compare "struc1" with "struc3": the operands must have the same structure'
      expect(() => cqn4sql(CQL(queryString), model)).to.throw(expectedError)
    })
  })
  it('proper error if structures cannot be compared / too many elements on lhs', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.EStrucSibling { ID } where not struc3 ${first} struc4`
      // const expectedError = `Can't compare "struc3" with "struc4": Path "oxx" not found in "struc4"`
      const expectedError = 'Can\'t compare "struc3" with "struc4": the operands must have the same structure'
      expect(() => cqn4sql(CQL(queryString), model)).to.throw(expectedError)
    })
  })

  it('join relevant structural comparison', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.EStrucSibling { ID } where not struc2 ${first} sibling.struc2`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.EStrucSibling as EStrucSibling
            left outer join bookshop.EStruc as sibling on sibling.ID = EStrucSibling.sibling_ID
          { EStrucSibling.ID }
            where not (EStrucSibling.struc2_foo ${first} sibling.struc2_foo AND
                       EStrucSibling.struc2_bar ${first} sibling.struc2_bar)`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })
  it('join relevant structural comparison / both operands are in assoc target', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.EStrucSibling { ID } where not sibling.struc2 ${first} sibling.struc2`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.EStrucSibling as EStrucSibling
            left outer join bookshop.EStruc as sibling on sibling.ID = EStrucSibling.sibling_ID
          { EStrucSibling.ID }
            where not (sibling.struc2_foo ${first} sibling.struc2_foo AND
                       sibling.struc2_bar ${first} sibling.struc2_bar)`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })
  it('join relevant structural comparison / both operands are in assoc target / not equal ops', () => {
    notEqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.EStrucSibling { ID } where not sibling.struc2 ${first} sibling.struc2`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.EStrucSibling as EStrucSibling
            left outer join bookshop.EStruc as sibling on sibling.ID = EStrucSibling.sibling_ID
          { EStrucSibling.ID }
            where not (sibling.struc2_foo ${first} sibling.struc2_foo or
                       sibling.struc2_bar ${first} sibling.struc2_bar)`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })
  it('join relevant structural comparison / both operands are in assoc target which is the source entity', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.EStrucSibling { ID } where not self.struc2 ${first} self.struc2`
      let query = cqn4sql(CQL(queryString), model)
      const expectedQueryString = `
          SELECT from bookshop.EStrucSibling as EStrucSibling
          left outer join bookshop.EStrucSibling as self on self.ID = EStrucSibling.self_ID
          { EStrucSibling.ID }
            where not (self.struc2_foo ${first} self.struc2_foo AND
                       self.struc2_bar ${first} self.struc2_bar)`
      expect(query).to.deep.equal(CQL(expectedQueryString))
    })
  })
  it('proper error for join relevant structural comparison / both operands are in assoc target', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.EStrucSibling { ID } where not sibling.struc2 ${first} struc3`
      expect(() => cqn4sql(CQL(queryString), model)).to.throw(
        `Can't compare "sibling.struc2" with "struc3": the operands must have the same structure`,
      )
    })
  })
  it('proper error for comparison w/ value', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.AssocWithStructuredKey { ID } where not AssocWithStructuredKey.toStructuredKey ${first} 5`
      expect(() => cqn4sql(CQL(queryString), model)).to.throw(
        'Can\'t compare structure "AssocWithStructuredKey.toStructuredKey" with value "5"',
      )
    })
  })
  it('proper error for comparison w/ value, reversed', () => {
    eqOps.forEach(op => {
      const [first] = op
      const queryString = `SELECT from bookshop.AssocWithStructuredKey { ID } where not 5 ${first} AssocWithStructuredKey.toStructuredKey`
      expect(() => cqn4sql(CQL(queryString), model)).to.throw(
        "An association can't be used as a value in an expression",
      )
    })
  })
  it('Struct needs to be unfolded in on-condition of join', () => {
    const query = CQL`SELECT from bookshop.Unmanaged {
      toSelf.field
    }`

    const expected = CQL`SELECT from bookshop.Unmanaged as Unmanaged
    left join bookshop.Unmanaged as toSelf
    on Unmanaged.struct_leaf = toSelf.struct_leaf and Unmanaged.struct_toBook_ID = toSelf.struct_toBook_ID {
      toSelf.field as toSelf_field
    }
    `
    const unfolded = cds.compile.for.nodejs(JSON.parse(JSON.stringify(model)))
    const structuredRes = cqn4sql(query, model)
    const unfoldedRes = cqn4sql(query, unfolded)
    //> REVISIT: remove fallback once UCSN is the new standard
    if (unfolded.meta.unfolded) {
      expect(structuredRes).to.eql(expected).to.eql(unfoldedRes)
    } else {
      // with odata csn, the on condition of the assoc is wrapped in xpr
      expect(structuredRes.SELECT.from.on).to.eql(expected.SELECT.from.on).to.eql(unfoldedRes.SELECT.from.on[0].xpr)
      expect(structuredRes.SELECT.columns).to.eql(expected.SELECT.columns).to.eql(unfoldedRes.SELECT.columns)
    }
  })
})
