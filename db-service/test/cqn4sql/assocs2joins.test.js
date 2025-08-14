'use strict'

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds')
const { expect } = cds.test


describe('Unfolding Association Path Expressions to Joins', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })



  // order of select items should stay untouched, no matter what path they follow

  // 2 different assocs lead to 2 JOINs, even if they have same target


  // TODO (SMW) decide: if we generate a join, should we then take the FK from source or from target?
  //                    currently we take it from the source

  // it('in where, one assoc, one field (2)', () => {
  //   let query = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID } where author.name like 'Schiller'`, model)
  //   expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books
  //       left outer join bookshop.Authors as author on author.ID = Books.author_ID
  //       { Books.ID } WHERE author.name like 'Schiller'
  //     `)
  // })

  // to discuss: same assoc handling in all clauses? (select, where, group, having, order)

  // fun with filters ... (far from complete)

  // filters are not part of the implicit alias generated for the result column

  // TODO (SMW) new test


  // TODO (SMW) new test
  // if FK field is accessed with filter, a JOIN is generated and the FK must be fetched from the association target



  // same filter - same join


  // we compare filters based on AST

  // TODO (SMW) new test



  // some notes for later:
  //   what if only field we fetch from assoc target is virtual? -> make join, but don't fetch anything (?)
})

describe('Variations on ON', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })


  // TODO (SMW) original ON condition must be enclosed in parens if there is a filter


  it('managed complicated', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID, a_assocYA.a as x }`, model)
    const expected = cds.ql`SELECT from bookshop.AssocMaze1 as AM
        left outer join bookshop.AssocMaze2 as a_assocYA
          on  a_assocYA.A_1_a    = AM.a_assocYA_B_1_a
          and a_assocYA.A_1_b_ID = AM.a_assocYA_B_1_b_ID
          and a_assocYA.A_2_a    = AM.a_assocYA_B_2_a
          and a_assocYA.A_2_b_ID = AM.a_assocYA_B_2_b_ID
        { AM.ID, a_assocYA.a as x }
      `
    expect(query).to.deep.equal(expected)
  })

  it('managed complicated backlink', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze2 as AM { a, a_assocYA_back.ID as x }`, model)
    const expected = cds.ql`SELECT from bookshop.AssocMaze2 as AM
        left outer join bookshop.AssocMaze1 as a_assocYA_back
          on   a_assocYA_back.a_assocYA_B_1_a    = AM.A_1_a
          and  a_assocYA_back.a_assocYA_B_1_b_ID = AM.A_1_b_ID
          and  a_assocYA_back.a_assocYA_B_2_a    = AM.A_2_a
          and  a_assocYA_back.a_assocYA_B_2_b_ID = AM.A_2_b_ID
        { AM.a, a_assocYA_back.ID as x }
      `
    expect(query).to.deep.equal(expected)
  })
})

describe('subqueries in from', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  // If a FROM subquery only _exposes_ an association which is then used in the main query,
  // the JOIN happens in the main query.

  // TODO (SMW) check again ...


  // (SMW) new
  // TODO move to extra section?
})

describe('Backlink Associations', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/model/A2J/schema').then(cds.linked)
  })

  // it('forward', () => {
  //   let query = cqn4sql(
  //     cds.ql`select from a2j.Header as Header {
  //       toItem_fwd.id,
  //     }`,
  //     model,
  //   )
  //   const expected = cds.ql`SELECT from a2j.Header as Header
  //       left outer join a2j.Item as toItem_fwd on Header.id = toItem_fwd.id
  //       { toItem_fwd.id as toItem_fwd_id}
  //     `
  //   expect(query).to.deep.equal(expected)
  // })
})

describe('Shared foreign key identity', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/model/A2J/sharedFKIdentity').then(cds.linked)
  })

})

describe('Where exists in combination with assoc to join', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

})

describe('comparisons of associations in on condition of elements needs to be expanded', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/model/A2J/schema').then(cds.linked)
  })

})

describe('optimize fk access', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/model/A2J/classes').then(cds.linked)
  })


  // it('optimized next to join relevant', () => {
  //   const query = cds.ql`SELECT from ClassroomsPupils as ClassroomsPupils {
  //     classroom.ID as classroom_ID,
  //     classroom.name as classroom,
  //   }`
  //   const expected = cds.ql`SELECT from ClassroomsPupils as ClassroomsPupils
  //                         left join Classrooms as classroom on classroom.ID = ClassroomsPupils.classroom_ID
  //                       {
  //                         ClassroomsPupils.classroom_ID as classroom_ID,
  //                         classroom.name as classroom
  //                       }`

  //   expect(cqn4sql(query, model)).to.deep.equal(expected)
  // })
})

describe('References to target side via dummy filter', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/model/A2J/TargetSideReferences').then(cds.linked)
  })


  it('round trip leads to join', () => {
    const query = cds.ql`
    SELECT from S.Source {
      toMid.toTarget.toSource.sourceID as fullForeignKey,
      toMid.toTarget.toSource.toMid.toTarget.toSource.sourceID as foreignKeyAfterRoundTrip,
    }`
    const expected = cds.ql`
    SELECT from S.Source as $S
      left join S.Mid as toMid on toMid.toTarget_toSource_sourceID = $S.toMid_toTarget_toSource_sourceID
      left join S.Target as toTarget on toTarget.toSource_sourceID = toMid.toTarget_toSource_sourceID
      left join S.Source as toSource on toSource.sourceID = toTarget.toSource_sourceID
    {
      $S.toMid_toTarget_toSource_sourceID as fullForeignKey,
      toSource.toMid_toTarget_toSource_sourceID as foreignKeyAfterRoundTrip
    }
    `

    expect(cqn4sql(query, model)).to.deep.equal(expected)
  })
})

describe('Assoc is foreign key', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/model/A2J/FKAccess').then(cds.linked)
  })

  it('path ends on assoc which is fk', () => {
    const q = cds.ql`SELECT from fkaccess.Books as Books {
      authorAddress.address as assocAsForeignKey
    }`
    const expected = cds.ql`SELECT from fkaccess.Books as Books {
      Books.authorAddress_address_street as assocAsForeignKey_street,
      Books.authorAddress_address_number as assocAsForeignKey_number,
      Books.authorAddress_address_zip as assocAsForeignKey_zip,
      Books.authorAddress_address_city as assocAsForeignKey_city,
    }`

    expect(cqn4sql(q, model)).to.deep.equal(expected)
  })

  it('path ends on assoc which is fk, prefix is structured', () => {
    const q = cds.ql`SELECT from fkaccess.Books as Books {
      deeply.nested.authorAddress.address as deepAssocAsForeignKey
    }`
    const expected = cds.ql`SELECT from fkaccess.Books as Books {
      Books.deeply_nested_authorAddress_address_street as deepAssocAsForeignKey_street,
      Books.deeply_nested_authorAddress_address_number as deepAssocAsForeignKey_number,
      Books.deeply_nested_authorAddress_address_zip as deepAssocAsForeignKey_zip,
      Books.deeply_nested_authorAddress_address_city as deepAssocAsForeignKey_city
    }`

    expect(cqn4sql(q, model)).to.deep.equal(expected)
  })

  it('path ends on assoc which is fk, renamed', () => {
    const q = cds.ql`SELECT from fkaccess.Books as Books {
      authorAddressFKRenamed.address as renamedAssocAsForeignKey
    }`

    const expected = cds.ql`SELECT from fkaccess.Books as Books {
      Books.authorAddressFKRenamed_bar_street as renamedAssocAsForeignKey_street,
      Books.authorAddressFKRenamed_bar_number as renamedAssocAsForeignKey_number,
      Books.authorAddressFKRenamed_bar_zip as renamedAssocAsForeignKey_zip,
      Books.authorAddressFKRenamed_bar_city as renamedAssocAsForeignKey_city
    }`

    expect(cqn4sql(q, model)).to.deep.equal(expected)
  })

  it('recursive path end on deeply nested struct that contains assoc', () => {
    const q = cds.ql`SELECT from fkaccess.Books as Books {
      toSelf.deeply.nested
    }`
    const expected = cds.ql`SELECT from fkaccess.Books as Books {
      Books.toSelf_baz_authorAddress_address_street as toSelf_deeply_nested_authorAddress_street,
      Books.toSelf_baz_authorAddress_address_number as toSelf_deeply_nested_authorAddress_number,
      Books.toSelf_baz_authorAddress_address_zip as toSelf_deeply_nested_authorAddress_zip,
      Books.toSelf_baz_authorAddress_address_city as toSelf_deeply_nested_authorAddress_city
    }`

    expect(cqn4sql(q, model)).to.deep.equal(expected)
  })

  
})
