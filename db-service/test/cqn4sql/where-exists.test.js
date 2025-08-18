'use strict'
const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds')
const { expect } = cds.test

/**
 * @TODO Review the mean tests and verify, that the resulting cqn 4 sql is valid.
 *       Especially w.r.t. to table aliases and bracing.
 */
describe('EXISTS predicate in where', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/srv/cat-service').then(cds.linked)
  })

  describe('access association after `exists` predicate', () => {






    //
    // lonely association in EXISTS + variations with table alias
    // "give me all authors who have a book"
    //


    // already tested in 'one unmanaged association, with explicit table alias (to-many)',
    // it('using explicit table alias of FROM clause', () => {
    //   let query = cqn4sql(cds.ql`SELECT from bookshop.Authors as A { ID } WHERE EXISTS A.books`, model)
    //   expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as A { A.ID } WHERE EXISTS (
    //       SELECT 1 from bookshop.Books as $b where $b.author_ID = A.ID
    //     )`)
    // })

  })
  describe('wrapped in expression', () => {


  })

  describe('infix filter', () => {
    // accessing FK of managed assoc in filter
    // --> managed assoc within structure
    // replaced by test which checks result
    // 
    // 
    // it('MUST not fail if following managed assoc in filter in where exists', () => {
    //   expect(() =>
    //     cqn4sql(
    //       cds.ql`SELECT from bookshop.Authors { ID } WHERE EXISTS books[dedication.addressee.name = 'Hasso']`,
    //       model,
    //     ),
    //   ).to.not.throw('Only foreign keys of “addressee” can be accessed in infix filter')
    // })

  })

  describe('nested exists in infix filter', () => {


    // --> paths for exists predicates?

    // let { query2 } = cqn4sql (cds.ql`SELECT from bookshop.Books { ID } where exists author[exists books.title = 'Harry Potter']`, model)
    // let { query3 } = cqn4sql (cds.ql`SELECT from bookshop.Books { ID } where exists author[books.title = 'Harry Potter']`, model)
    // let { query4 } = cqn4sql (cds.ql`SELECT from bookshop.Books { ID } where exists author.books[title = 'Harry Potter']`, model)
    // let { query5 } = cqn4sql (cds.ql`SELECT from bookshop.Books { ID } where exists author.books.title = 'Harry Potter'`, model)

    //
    // nested EXISTS and more than one assoc
    // pretty weird ...
    // `EXISTS author or title = 'Gravity'` -> filter condition is wrapped in xpr because of `OR`
    //  compare to the second exits subquery which does not need to be wrapped in xpr

  })

  describe('navigating along associations', () => {
    //
    // more than one assoc in EXISTS
    //

    //
    // nested EXISTS
    //
  })

  describe('inside CASE statement', () => {
    //
    // exists inside CASE
    //
  })

  describe('association has structured keys', () => {
    //
    // association with filter in EXISTS
    //
    //
    // assocs with complicated ON
    //

    // TODO test with ... assoc path in from with FKs being managed assoc with explicit aliased FKs
  })
})

describe('EXISTS predicate in infix filter', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/srv/cat-service').then(cds.linked)
  })
})

describe('Scoped queries', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/srv/cat-service').then(cds.linked)
  })











  //
  // convenience:
  //   shortcut notation (providing only value) allowed in filter if association target has exactly one PK
  //


  // (SMW) TODO: check




  // (SMW) need more tests with unmanaged ON conds using all sorts of stuff -> e.g. struc access in ON, FK of mgd assoc in FROM ...
  //
  // assocs with complicated ON




  /**
   * TODO
   * - multiple query sources with path expressions in from
   * - merge where exists from assoc steps in from clause with existing where exists
   * - test with `… from <entity>.<struct>.<assoc> …`
   */
})

describe('Path expressions in from combined with `exists` predicate', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/srv/cat-service').then(cds.linked)
  })
  //
  // mixing path in FROM and WHERE EXISTS
  // SMW -> move that in a seperate "describe" ?
  //

  // semantically same as above
})

describe('comparisons of associations in on condition of elements needs to be expanded', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/model/A2J/schema').then(cds.linked)
  })
})

describe('path expression within infix filter following exists predicate', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/srv/cat-service').then(cds.linked)
  })
})

describe('define additional query modifiers', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/srv/cat-service').then(cds.linked)
  })
})
