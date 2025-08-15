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
    it('exists predicate after having', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Books { ID } group by ID having exists author`, model)
      // having only works on aggregated queries, hence the "group by" to make
      // the example more "real life"
      expect(query).to.deep.equal(
        cds.ql`SELECT from bookshop.Books as $B { $B.ID }
         GROUP BY $B.ID
         HAVING EXISTS (
          SELECT 1 from bookshop.Authors as $a where $a.ID = $B.author_ID
         )`,
      )
    })
    it('exists predicate after having with infix filter', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Books { ID } group by ID having exists author[ID=42]`, model)
      // having only works on aggregated queries, hence the "group by" to make
      // the example more "real life"
      expect(query).to.deep.equal(
        cds.ql`SELECT from bookshop.Books as $B { $B.ID }
         GROUP BY $B.ID
         HAVING EXISTS (
          SELECT 1 from bookshop.Authors as $a where $a.ID = $B.author_ID and $a.ID = 42
         )`,
      )
    })






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

    it('... managed association with explicit FKs being path into a struc', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID } where exists a_part`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.AssocMaze1 as AM { AM.ID } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze2 as $a where $a.A_1_a = AM.a_part_a and $a.S_2_b = AM.a_part_b
      )`)
    })
  })
})

describe('EXISTS predicate in infix filter', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/srv/cat-service').then(cds.linked)
  })

  it('reject non foreign key access in infix filter', async () => {
    const model = await cds.load(__dirname + '/model/collaborations').then(cds.linked)
    const q = cds.ql`
      SELECT from Collaborations {
        id
      }
       where exists leads[ participant.scholar_userID = $user.id ]
    `
    // maybe in the future this could be something like this
    // the future is here...
    // eslint-disable-next-line no-unused-vars
    const expectation = cds.ql`
      SELECT from Collaborations as Collaborations {
        Collaborations.id
      } where exists (
        SELECT 1 from CollaborationLeads as leads
          left join CollaborationParticipants as participant on participant.ID = leads.participant_id
          where (leads.collaboration_id = Collaborations.id)
            and leads.isLead = true
            and participant.scholar_userID = $user.id
      )
    `
    expect(() => {
      cqn4sql(q, cds.compile.for.nodejs(JSON.parse(JSON.stringify(model))))
    })
      .to.not.throw(/Only foreign keys of “participant” can be accessed in infix filter/)
      .and.to.eql(expectation)
  })
})

describe('Scoped queries', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/srv/cat-service').then(cds.linked)
  })

  it('does not ignore the expand root from being considered for the table alias calculation', () => {
    const originalQuery = cds.ql`SELECT from bookshop.Genres:parent.parent.parent { ID }`
    // table aliases for `query.SELECT.expand === true` are not materialized in the transformed query and must be ignored
    // however, for the main query having the `query.SELECT.expand === 'root'` we must consider the table aliases
    originalQuery.SELECT.expand = 'root'
    let query = cqn4sql(originalQuery, model)

    // clean up so that the queries match
    delete originalQuery.SELECT.expand

    expect(query).to.deep.equal(cds.ql`
      SELECT from bookshop.Genres as $p { $p.ID }
      where exists (
        SELECT 1 from bookshop.Genres as $p2
          where $p2.parent_ID = $p.ID and
          exists (
            SELECT 1 from bookshop.Genres as $p3
              where $p3.parent_ID = $p2.ID  and
              exists (
                SELECT 1 from bookshop.Genres as $G
                where $G.parent_ID = $p3.ID
              )
          )
      )
    `)
  })

  //TODO infix filter with association with structured foreign key

  //(SMW) TODO I'd prefer to have the cond from the filter before the cond coming from the WHERE
  // which, by the way, is the case in tests below where we have a path in FROM -> ???
  it('handles infix filter at entity and WHERE clause', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books[price < 12.13] as Books {Books.ID} where stock < 11`, model)
    expect(query).to.deep.equal(
      cds.ql`SELECT from bookshop.Books as Books {Books.ID} WHERE (Books.stock < 11) and (Books.price < 12.13)`,
    )
  })
  it('handles multiple assoc steps', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.TestPublisher:texts {ID}`, model)
    expect(query).to.deep.equal(
      cds.ql`SELECT from bookshop.TestPublisher.texts as $t {$t.ID} WHERE exists (
        SELECT 1 from bookshop.TestPublisher as $T2 where $t.publisher_structuredKey_ID = $T2.publisher_structuredKey_ID
      )`,
    )
  })
  it.skip('handles multiple assoc steps with renamed keys', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.TestPublisher:textsRenamedPublisher {ID}`, model)
    expect(query).to.deep.equal(
      cds.ql`SELECT from bookshop.TestPublisher.texts as textsRenamedPublisher {textsRenamedPublisher.ID} WHERE exists (
        SELECT 1 from bookshop.TestPublisher as TestPublisher where textsRenamedPublisher.publisherRenamedKey_notID = TestPublisher.publisherRenamedKey_notID
      )`,
    )
  })

  it('handles infix filter with nested xpr at entity and WHERE clause', () => {
    let query = cqn4sql(
      cds.ql`
      SELECT from bookshop.Books[not (price < 12.13)] as Books { Books.ID } where stock < 11
      `,
      model,
    )
    expect(query).to.deep.equal(
      cds.ql`SELECT from bookshop.Books as Books {Books.ID} WHERE (Books.stock < 11) and (not (Books.price < 12.13))`,
    )
  })

  //(SMW) TODO I'd prefer to have the cond from the filter before the cond coming from the WHERE
  // which, by the way, is the case in tests below where we have a path in FROM -> ???
  it('gets precedence right for infix filter at entity and WHERE clause', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Books[price < 12.13 or stock > 77] as Books {Books.ID} where stock < 11 or price > 17.89`,
      model,
    )
    expect(query).to.deep.equal(
      cds.ql`SELECT from bookshop.Books as Books {Books.ID} WHERE (Books.stock < 11 or Books.price > 17.89) and (Books.price < 12.13 or Books.stock > 77)`,
    )
    //expect (query) .to.deep.equal (cds.ql`SELECT from bookshop.Books as Books {Books.ID} WHERE (Books.price < 12.13 or Books.stock > 77) and (Books.stock < 11 or Books.price > 17.89)`)  // (SMW) want this
  })

  it('FROM path ends on to-one association', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books:author { name }`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as $a { $a.name }
        WHERE EXISTS ( SELECT 1 from bookshop.Books as $B where $B.author_ID = $a.ID
      )`)
  })
  it('unmanaged to one with (multiple) $self in on-condition', () => {
    // $self in refs of length > 1 can just be ignored semantically
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books:coAuthorUnmanaged { name }`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as $c { $c.name }
        WHERE EXISTS ( SELECT 1 from bookshop.Books as $B where $c.ID = $B.coAuthor_ID_unmanaged
      )`)
  })
  it('handles FROM path with association with explicit table alias', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books:author as author { author.name }`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as author { author.name }
        WHERE EXISTS ( SELECT 1 from bookshop.Books as $B where $B.author_ID = author.ID
      )`)
  })

  it('handles FROM path with association with mean explicit table alias', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books:author as $B { name, $B.dateOfBirth }`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as $B { $B.name, $B.dateOfBirth}
        WHERE EXISTS ( SELECT 1 from bookshop.Books as $B2 where $B2.author_ID = $B.ID
      )`)
  })

  it('handles FROM path with backlink association', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Authors:books as books {books.ID}`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as books {books.ID} WHERE EXISTS (
        SELECT 1 from bookshop.Authors as $A where $A.ID = books.author_ID
      )`)
  })
  it('handles FROM path with backlink association for association-like calculated element', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Authors:booksWithALotInStock as booksWithALotInStock {booksWithALotInStock.ID}`, model)
    expect(query).to.deep
      .equal(cds.ql`SELECT from bookshop.Books as booksWithALotInStock {booksWithALotInStock.ID} WHERE EXISTS (
        SELECT 1 from bookshop.Authors as $A where ( $A.ID = booksWithALotInStock.author_ID ) and ( booksWithALotInStock.stock > 100 )
      )`)
  })

  it('handles FROM path with unmanaged composition and prepends source side alias', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books:texts { locale }`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books.texts as $t {$t.locale} WHERE EXISTS (
        SELECT 1 from bookshop.Books as $B where $t.ID = $B.ID
      )`)
  })

  it('handles FROM path with struct and association', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books:dedication.addressee { dateOfBirth }`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Person as $a { $a.dateOfBirth }
        WHERE EXISTS ( SELECT 1 from bookshop.Books as $B where $B.dedication_addressee_ID = $a.ID
      )`)
  })

  it('handles FROM path with struct and association (2)', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.DeepRecursiveAssoc:one.two.three.toSelf { ID }`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.DeepRecursiveAssoc as $t { $t.ID }
        WHERE EXISTS (
          SELECT 1 from bookshop.DeepRecursiveAssoc as $D where $D.one_two_three_toSelf_ID = $t.ID
      )`)
  })
  it('handles FROM path with filter at entity plus association', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books[ID=201]:author as author {author.ID}`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as author {author.ID} WHERE EXISTS (
        SELECT 1 from bookshop.Books as $B where $B.author_ID = author.ID and $B.ID=201
      )`)
  })

  // (SMW) here the explicit WHERE comes at the end (as it should be)
  it('handles FROM path with association and filters and WHERE', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Books[ID=201 or ID=202]:author[ID=4711 or ID=4712] as author {author.ID} where author.name='foo' or name='bar'`,
      model,
    )
    expect(query).to.deep.equal(
      cds.ql`SELECT from bookshop.Authors as author {author.ID}
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B where $B.author_ID = author.ID and ($B.ID=201 or $B.ID=202)
        ) and (author.ID=4711 or author.ID=4712) and (author.name='foo' or author.name='bar')`,
    )
  })

  it('handles FROM path with association with one infix filter at leaf step', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books:author[ID=4711] as author {author.ID}`, model)
    expect(query).to.deep.equal(
      cds.ql`SELECT from bookshop.Authors as author {author.ID}
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B where $B.author_ID = author.ID
        ) and author.ID=4711`,
    )
  })

  //
  // convenience:
  //   shortcut notation (providing only value) allowed in filter if association target has exactly one PK
  //

  // (SMW) TODO check
  // (PB) modified -> additional where condition e.g. infix filter in result are wrapped in `xpr`
  it('MUST ... in from clauses with infix filters, ODATA variant w/o mentioning key', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books[201]:author[150] {ID}`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as $a {$a.ID} WHERE EXISTS (
        SELECT 1 from bookshop.Books as $B where $B.author_ID = $a.ID and $B.ID=201
      ) AND $a.ID = 150`)
  })

  // (SMW) TODO msg not good -> filter in general is ok for assoc with multiple FKS,
  // only shortcut notation is not allowed
  // TODO: message can include the fix: `write ”<key> = 42” explicitly`
  it('MUST ... reject filters on associations with multiple foreign keys', () => {
    expect(() => cqn4sql(cds.ql`SELECT from bookshop.AssocWithStructuredKey:toStructuredKey[42]`, model)).to.throw(
      /Filters can only be applied to managed associations which result in a single foreign key/,
    )
  })

  // (SMW) TODO: check
  it('MUST ... in from clauses with infix filters ODATA variant w/o mentioning key ORDERS/ITEMS', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Orders[201]:items[2] {pos}`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Orders.items as $i {$i.pos} WHERE EXISTS (
        SELECT 1 from bookshop.Orders as $O where $O.ID = $i.up__ID and $O.ID = 201
      ) AND $i.pos = 2`)
  })

  // usually, "Filters can only be applied to managed associations which result in a single foreign key"
  // but because "up__ID" is the foreign key for the backlink association of "items", it is already part of the inner where
  // `where` condition of the exists subquery. Hence we enable this shortcut notation.
  it('MUST ... contain foreign keys of backlink association in on-condition?', () => {
    const query = cqn4sql(cds.ql`SELECT from bookshop.Orders:items[2] {pos}`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Orders.items as $i {$i.pos} WHERE EXISTS (
      SELECT 1 from bookshop.Orders as $O where $O.ID = $i.up__ID
    ) and $i.pos = 2`)
  })

  it('same as above but mention key', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Orders:items[pos=2] {pos}`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Orders.items as $i {$i.pos} WHERE EXISTS (
        SELECT 1 from bookshop.Orders as $O where $O.ID = $i.up__ID
      ) and $i.pos = 2`)
  })

  // TODO
  it.skip('MUST ... contain foreign keys of backlink association in on-condition? (3)', () => {
    expect(() => cqn4sql(cds.ql`SELECT from bookshop.Orders.items[2] {pos}`, model)).to.throw(
      /Please specify all primary keys in the infix filter/,
    )
  })

  it('MUST ... be possible to address fully qualified, partial key in infix filter', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Orders.items[pos=2] {pos}`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Orders.items as $i {$i.pos} where $i.pos = 2`)
  })

  it('handles paths with two associations', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Authors:books.genre as genre {genre.ID}`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Genres as genre {genre.ID} WHERE EXISTS (
        SELECT 1 from bookshop.Books as $b where $b.genre_ID = genre.ID and EXISTS (
          SELECT 1 from bookshop.Authors as $A where $A.ID = $b.author_ID
        )
      )`)
  })
  it('handles paths with two associations, first is association-like calculated element', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Authors:booksWithALotInStock.genre as genre {genre.ID}`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Genres as genre {genre.ID} WHERE EXISTS (
        SELECT 1 from bookshop.Books as $b where $b.genre_ID = genre.ID and EXISTS (
          SELECT 1 from bookshop.Authors as $A where ( $A.ID = $b.author_ID ) and ( $b.stock > 100 )
        )
      )`)
  })

  it('handles paths with two associations (mean alias)', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Authors:books.genre as books {books.ID}`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Genres as books {books.ID} WHERE EXISTS (
        SELECT 1 from bookshop.Books as $b where $b.genre_ID = books.ID and EXISTS (
          SELECT 1 from bookshop.Authors as $A where $A.ID = $b.author_ID
        )
      )`)
  })

  it('handles paths with three associations', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Authors:books.genre.parent as $p {$p.ID}`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Genres as $p {$p.ID} WHERE EXISTS (
        SELECT 1 from bookshop.Genres as $g where $g.parent_ID = $p.ID and EXISTS (
          SELECT 1 from bookshop.Books as $b where $b.genre_ID = $g.ID and EXISTS (
            SELECT 1 from bookshop.Authors as $A where $A.ID = $b.author_ID
          )
        )
      )`)
  })

  it('handles paths with recursive associations', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Authors:books.genre.parent.parent.parent as $p {$p.ID}`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Genres as $p {$p.ID}
      WHERE EXISTS (
        SELECT 1 from bookshop.Genres as $p2 where $p2.parent_ID = $p.ID and EXISTS (
          SELECT 1 from bookshop.Genres as $p3 where $p3.parent_ID = $p2.ID and EXISTS (
            SELECT 1 from bookshop.Genres as $g where $g.parent_ID = $p3.ID and EXISTS (
              SELECT 1 from bookshop.Books as $b where $b.genre_ID = $g.ID and EXISTS (
                SELECT 1 from bookshop.Authors as $A where $A.ID = $b.author_ID
              )
            )
          )
        )
      )`)
  })

  it('handles paths with unmanaged association', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Baz:parent {id}`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Baz as $p {$p.id} WHERE EXISTS (
        SELECT 1 from bookshop.Baz as $B where $p.id = $B.parent_id or $p.id > 17
      )`)
  })

  it('handles paths with unmanaged association with alias', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Baz:parent as A {id}`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Baz as A {A.id} WHERE EXISTS (
        SELECT 1 from bookshop.Baz as $B where A.id = $B.parent_id or A.id > 17
      )`)
  })

  // (SMW) need more tests with unmanaged ON conds using all sorts of stuff -> e.g. struc access in ON, FK of mgd assoc in FROM ...

  it('transforms unmanaged association to where exists subquery and infix filter', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Baz:parent[id<20] as my {my.id}`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Baz as my {my.id} WHERE EXISTS (
        SELECT 1 from bookshop.Baz as $B where my.id = $B.parent_id or my.id > 17
      ) AND my.id < 20`)
  })
  it('transforms unmanaged association to where exists subquery with multiple infix filter', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Baz:parent[id<20 or id > 12] as my { my.id }`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Baz as my {my.id} WHERE EXISTS (
        SELECT 1 from bookshop.Baz as $B where my.id = $B.parent_id or my.id > 17
      ) AND (my.id < 20 or my.id > 12)`)
  })

  //
  // assocs with complicated ON
  //

  it('exists predicate in infix filter in FROM', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Authors[exists books] {ID}`, model)
    expect(query).to.deep.equal(
      cds.ql`SELECT from bookshop.Authors as $A {$A.ID}
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b where $b.author_ID = $A.ID
        )`,
    )
  })

  it('exists predicate in infix filter at ssoc path step in FROM', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books:author[exists books] {ID}`, model)
    expect(query).to.deep.equal(
      cds.ql`SELECT from bookshop.Authors as $a {$a.ID}
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B where $B.author_ID = $a.ID
        ) and EXISTS (
          SELECT 1 from bookshop.Books as $b2 where $b2.author_ID = $a.ID
        )`,
    )
  })

  it('exists predicate followed by unmanaged assoc as infix filter (also within xpr)', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Books:author[exists books[exists coAuthorUnmanaged or title = 'Sturmhöhe']] { ID }`,
      model,
    )
    expect(query).to.deep.equal(
      cds.ql`SELECT from bookshop.Authors as $a {$a.ID}
            where exists (
              SELECT 1 from bookshop.Books as $B where $B.author_ID = $a.ID
            ) and exists (
              SELECT 1 from bookshop.Books as $b2 where $b2.author_ID = $a.ID
              and
              (
                exists (
                SELECT 1 from bookshop.Authors as $c where $c.ID = $b2.coAuthor_ID_unmanaged
                )  or $b2.title = 'Sturmhöhe'
              )
            )
      `,
    )
  })

  it('exists predicate in infix filter followed by assoc in FROM', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books[exists genre]:author {ID}`, model)
    expect(query).to.deep.equal(
      cds.ql`SELECT from bookshop.Authors as $a {$a.ID}
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B where $B.author_ID = $a.ID
            and EXISTS (
              SELECT 1 from bookshop.Genres as $g where $g.ID = $B.genre_ID
            )
        )`,
    )
  })

  it('exists predicate in infix filters in FROM', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books[exists genre]:author[exists books] {ID}`, model)
    expect(query).to.deep.equal(
      cds.ql`SELECT from bookshop.Authors as $a {$a.ID}
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B where $B.author_ID = $a.ID
          and EXISTS (
            SELECT 1 from bookshop.Genres as $g where $g.ID = $B.genre_ID
          )
        ) and EXISTS (
          SELECT 1 from bookshop.Books as $b2 where $b2.author_ID = $a.ID
        )`,
    )
  })

  // (SMW) revisit: semantically correct, but order of infix filter and exists subqueries not consistent
  it('exists predicate in infix filters in FROM, multiple assoc steps', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Books[exists genre]:author[exists books].books[exists genre] {ID}`,
      model,
    )
    expect(query).to.deep.equal(
      cds.ql`SELECT from bookshop.Books as $b {$b.ID}
        WHERE EXISTS (
          SELECT 1 from bookshop.Authors as $a where $a.ID = $b.author_ID
            and EXISTS (
              SELECT 1 from bookshop.Books as $b2 where $b2.author_ID = $a.ID
            )
            and EXISTS (
              SELECT 1 from bookshop.Books as $B3 where $B3.author_ID = $a.ID
                and EXISTS (
                  SELECT 1 from bookshop.Genres as $g where $g.ID = $B3.genre_ID
                )
          )
        ) and EXISTS (
          SELECT 1 from bookshop.Genres as $g2 where $g2.ID = $b.genre_ID
        )`,
    )
  })

  it('... managed association with structured FK', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1:a_struc as a_struc { val }`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.AssocMaze2 as a_struc { a_struc.val } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze1 as $A where $A.a_struc_ID_1_a = a_struc.ID_1_a and $A.a_struc_ID_1_b = a_struc.ID_1_b
                                                          and $A.a_struc_ID_2_a = a_struc.ID_2_a and $A.a_struc_ID_2_b =  a_struc.ID_2_b
      )`)
  })

  it('... managed association with explicit simple FKs', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1:a_strucX as a_strucX { val }`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.AssocMaze2 as a_strucX { a_strucX.val } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze1 as $A where $A.a_strucX_a = a_strucX.a and $A.a_strucX_b = a_strucX.b
      )`)
  })

  it('... managed association with explicit structured FKs', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1:a_strucY as a_strucY { val }`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.AssocMaze2 as a_strucY { a_strucY.val } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze1 as $A where $A.a_strucY_S_1_a = a_strucY.S_1_a and $A.a_strucY_S_1_b = a_strucY.S_1_b
                                                          and $A.a_strucY_S_2_a = a_strucY.S_2_a and $A.a_strucY_S_2_b = a_strucY.S_2_b
      )`)
  })

  it('... managed association with explicit structured aliased FKs', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1:a_strucXA as a_strucXA { val }`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.AssocMaze2 as a_strucXA { a_strucXA.val } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze1 as $A where $A.a_strucXA_T_1_a = a_strucXA.S_1_a and $A.a_strucXA_T_1_b = a_strucXA.S_1_b
                                                          and $A.a_strucXA_T_2_a = a_strucXA.S_2_a and $A.a_strucXA_T_2_b = a_strucXA.S_2_b
      )`)
  })

  it('... managed associations with FKs being managed associations', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1:a_assoc as a_assoc { val }`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.AssocMaze3 as a_assoc { a_assoc.val } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze1 as $A where $A.a_assoc_assoc1_ID_1_a = a_assoc.assoc1_ID_1_a and $A.a_assoc_assoc1_ID_1_b = a_assoc.assoc1_ID_1_b
                                                          and $A.a_assoc_assoc1_ID_2_a = a_assoc.assoc1_ID_2_a and $A.a_assoc_assoc1_ID_2_b = a_assoc.assoc1_ID_2_b
                                                          and $A.a_assoc_assoc2_ID_1_a = a_assoc.assoc2_ID_1_a and $A.a_assoc_assoc2_ID_1_b = a_assoc.assoc2_ID_1_b
                                                          and $A.a_assoc_assoc2_ID_2_a = a_assoc.assoc2_ID_2_a and $A.a_assoc_assoc2_ID_2_b = a_assoc.assoc2_ID_2_b
      )`)
  })

  it('... managed association with explicit FKs being managed associations', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1:a_assocY as a_assocY { val }`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.AssocMaze2 as a_assocY { a_assocY.val } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze1 as $A where $A.a_assocY_A_1_a = a_assocY.A_1_a and $A.a_assocY_A_1_b_ID = a_assocY.A_1_b_ID
                                                          and $A.a_assocY_A_2_a = a_assocY.A_2_a and $A.a_assocY_A_2_b_ID = a_assocY.A_2_b_ID
      )`)
  })

  it('... managed association with explicit aliased FKs being managed associations', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1:a_assocYA as a_assocYA { val }`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.AssocMaze2 as a_assocYA { a_assocYA.val } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze1 as $A where $A.a_assocYA_B_1_a = a_assocYA.A_1_a and $A.a_assocYA_B_1_b_ID = a_assocYA.A_1_b_ID
                                                          and $A.a_assocYA_B_2_a = a_assocYA.A_2_a and $A.a_assocYA_B_2_b_ID = a_assocYA.A_2_b_ID
      )`)
  })

  it('... managed associations with FKs being mix of struc and managed assoc', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1:a_strass as a_strass { val }`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.AssocMaze4 as a_strass { a_strass.val } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze1 as $A
          where $A.a_strass_A_1_a = a_strass.A_1_a
            and $A.a_strass_A_1_b_assoc1_ID_1_a = a_strass.A_1_b_assoc1_ID_1_a and $A.a_strass_A_1_b_assoc1_ID_1_b = a_strass.A_1_b_assoc1_ID_1_b
            and $A.a_strass_A_1_b_assoc1_ID_2_a = a_strass.A_1_b_assoc1_ID_2_a and $A.a_strass_A_1_b_assoc1_ID_2_b = a_strass.A_1_b_assoc1_ID_2_b
            and $A.a_strass_A_1_b_assoc2_ID_1_a = a_strass.A_1_b_assoc2_ID_1_a and $A.a_strass_A_1_b_assoc2_ID_1_b = a_strass.A_1_b_assoc2_ID_1_b
            and $A.a_strass_A_1_b_assoc2_ID_2_a = a_strass.A_1_b_assoc2_ID_2_a and $A.a_strass_A_1_b_assoc2_ID_2_b = a_strass.A_1_b_assoc2_ID_2_b
            and $A.a_strass_A_2_a = a_strass.A_2_a
            and $A.a_strass_A_2_b_assoc1_ID_1_a = a_strass.A_2_b_assoc1_ID_1_a and $A.a_strass_A_2_b_assoc1_ID_1_b = a_strass.A_2_b_assoc1_ID_1_b
            and $A.a_strass_A_2_b_assoc1_ID_2_a = a_strass.A_2_b_assoc1_ID_2_a and $A.a_strass_A_2_b_assoc1_ID_2_b = a_strass.A_2_b_assoc1_ID_2_b
            and $A.a_strass_A_2_b_assoc2_ID_1_a = a_strass.A_2_b_assoc2_ID_1_a and $A.a_strass_A_2_b_assoc2_ID_1_b = a_strass.A_2_b_assoc2_ID_1_b
            and $A.a_strass_A_2_b_assoc2_ID_2_a = a_strass.A_2_b_assoc2_ID_2_a and $A.a_strass_A_2_b_assoc2_ID_2_b = a_strass.A_2_b_assoc2_ID_2_b
      )`)
  })

  it('on condition of to many composition in csn model has xpr', () => {
    const q = cds.ql`
      SELECT from bookshop.WorklistItems[ID = 1 and snapshotHash = 0]:releaseChecks[ID = 1 and snapshotHash = 0].detailsDeviations
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
    `
    expect(cqn4sql(q, model)).to.deep.equal(expected)
  })
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

  it('OData lambda where exists with unmanaged assoc', () => {
    const query = cqn4sql(cds.ql`SELECT from a2j.Foo as Foo { ID } where exists buzUnmanaged`, model)
    const expected = cds.ql`
      SELECT from a2j.Foo as Foo {
        Foo.ID
      } where exists (
        SELECT 1 FROM a2j.Buz as $b
          where $b.bar_foo_ID = Foo.bar_foo_ID AND $b.bar_ID = Foo.bar_ID and $b.foo_ID = Foo.ID
      )
    `
    expect(query).to.eql(expected)
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
