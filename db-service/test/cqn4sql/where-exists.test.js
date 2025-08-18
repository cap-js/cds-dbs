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



  it('on condition of to many composition in csn model has xpr and dangling filter', () => {
    const q = cds.ql`
      SELECT from bookshop.WorklistItems[ID = 1 and snapshotHash = 0]
      :releaseChecks[ID = 1 and snapshotHash = 0]
      .detailsDeviations[ID='0' and snapshotHash='0'and batch_ID='*' and material_ID='1']
    `
    const expected = cds.ql`
      SELECT from bookshop.QualityDeviations as $d {
        $d.snapshotHash,
        $d.ID,
        $d.batch_ID,
        $d.material_ID,
      } where exists (
        SELECT 1 from bookshop.WorklistItem_ReleaseChecks as $r
        where $d.material_ID = $r.parent_releaseDecisionTrigger_batch_material_ID
              and ( $d.batch_ID = '*' or $d.batch_ID = $r.parent_releaseDecisionTrigger_batch_ID )
              and $d.snapshotHash = $r.snapshotHash
              and $r.ID = 1 and $r.snapshotHash = 0
              and exists (
                SELECT 1 from bookshop.WorklistItems as $W
                where $r.parent_ID = $W.ID
                  and $r.parent_snapshotHash = $W.snapshotHash
                  and $W.ID = 1 and $W.snapshotHash = 0
              )
      )
      and (
              $d.ID = '0'
          and $d.snapshotHash = '0'
          and $d.batch_ID = '*'
          and $d.material_ID = '1'
        )
    `
    expect(cqn4sql(q, model)).to.deep.equal(expected)
  })

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
  it('MUST ... mixed with path in FROM clause', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books:genre as genre { ID } where exists parent`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Genres as genre { genre.ID }
        WHERE EXISTS ( SELECT 1 from bookshop.Books as $B where $B.genre_ID = genre.ID )
          AND EXISTS ( SELECT 1 from bookshop.Genres as $p where $p.ID = genre.parent_ID )
      `)
  })

  // semantically same as above
  it('MUST ... EXISTS in filter in FROM', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books:genre[exists parent] { ID }`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Genres as $g { $g.ID }
        WHERE EXISTS ( SELECT 1 from bookshop.Books as $B where $B.genre_ID = $g.ID )
          AND EXISTS ( SELECT 1 from bookshop.Genres as $p where $p.ID = $g.parent_ID )
      `)
  })
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
