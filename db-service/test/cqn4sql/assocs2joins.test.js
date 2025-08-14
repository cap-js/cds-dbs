// This test suite has been split up and moved to /assoc2join.test/

// on this branch:   851 passing (2s)

// on main:   855 passing (2s)

// the following tests are not relevant anymore (covered by other tests):

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

// it('in where, one assoc, one field (2)', () => {
//   let query = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID } where author.name like 'Schiller'`, model)
//   expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books
//       left outer join bookshop.Authors as author on author.ID = Books.author_ID
//       { Books.ID } WHERE author.name like 'Schiller'
//     `)
// })

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
})

describe('References to target side via dummy filter', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/model/A2J/TargetSideReferences').then(cds.linked)
  })
})

describe('Assoc is foreign key', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/model/A2J/FKAccess').then(cds.linked)
  })
})
