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

  it('in select, two levels of assocs (3)', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Authors as Authors
       { ID,
         books[stock=1].genre[code='A'].descr as d1,
         books[stock=2].genre[code='A'].descr as d2
       }`,
      model,
    )
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as Authors
        left outer join bookshop.Books as books on books.author_ID = Authors.ID AND books.stock = 1
        left outer join bookshop.Genres as genre on genre.ID = books.genre_ID AND genre.code = 'A'
        left outer join bookshop.Books as books2 on books2.author_ID = Authors.ID AND books2.stock = 2
        left outer join bookshop.Genres as genre2 on genre2.ID = books2.genre_ID AND genre2.code = 'A'
        { Authors.ID,
          genre.descr as d1,
          genre2.descr as d2
        }
      `)
  })

  it('in select/where, two levels of assocs', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Authors as Authors
       { ID,
         books[stock=1].genre[code='A'].descr
       } where books[stock=1].genre[code='B'].descr = 'foo'`,
      model,
    )
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as Authors
        left outer join bookshop.Books as books on books.author_ID = Authors.ID AND books.stock = 1
        left outer join bookshop.Genres as genre on genre.ID = books.genre_ID AND genre.code = 'A'
        left outer join bookshop.Genres as genre2 on genre2.ID = books.genre_ID AND genre2.code = 'B'
        { Authors.ID,
          genre.descr as books_genre_descr
        } where genre2.descr = 'foo'
      `)
  })

  it('in select, two levels of assocs, with case', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Authors as Authors
       { ID,
         case when ID<4 then books[stock=1].genre[code='A'].descr
              when ID>4 then books[stock=1].genre[code='B'].descr
         end as descr
       }`,
      model,
    )
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as Authors
        left outer join bookshop.Books as books on books.author_ID = Authors.ID AND books.stock = 1
        left outer join bookshop.Genres as genre on genre.ID = books.genre_ID AND genre.code = 'A'
        left outer join bookshop.Genres as genre2 on genre2.ID = books.genre_ID AND genre2.code = 'B'
        { Authors.ID,
          case when Authors.ID<4 then genre.descr
               when Authors.ID>4 then genre2.descr
          end as descr
        }
      `)
  })

  // TODO (SMW) new test
  it('in select, two levels of assocs, with case and exists', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Authors as Authors
       { ID,
         case when exists books[price>10]  then books[stock=1].genre[code='A'].descr
              when exists books[price>100] then books[stock=1].genre[code='B' or code='C'].descr
         end as descr
       }`,
      model,
    )
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as Authors
        left outer join bookshop.Books as books on books.author_ID = Authors.ID AND books.stock = 1
        left outer join bookshop.Genres as genre on genre.ID = books.genre_ID AND genre.code = 'A'
        left outer join bookshop.Genres as genre2 on genre2.ID = books.genre_ID AND (genre2.code = 'B' or genre2.code = 'C')
        { Authors.ID,
          case when exists (select 1 from bookshop.Books as $b where $b.author_ID = Authors.ID and $b.price > 10)
               then genre.descr
               when exists (select 1 from bookshop.Books as $b2 where $b2.author_ID = Authors.ID and $b2.price > 100)
               then genre2.descr
          end as descr
        }
      `)
  })

  it('in select, filter with exists', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Authors as Authors
       { ID,
         books[exists genre[code='A']].title
       }`,
      model,
    )
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as Authors
        left outer join bookshop.Books as books on books.author_ID = Authors.ID AND
          exists (select 1 from bookshop.Genres as $g where $g.ID = books.genre_ID and $g.code = 'A')
        { Authors.ID,
          books.title as books_title
        }
      `)
  })

  it('in select, filter (with OR needs bracelets) with exists ', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Authors as Authors
       { ID,
         books[exists genre[code='A' or code='B']].title
       }`,
      model,
    )
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as Authors
        left outer join bookshop.Books as books on books.author_ID = Authors.ID AND
          exists (select 1 from bookshop.Genres as $g where $g.ID = books.genre_ID and ($g.code = 'A' or $g.code = 'B'))
        { Authors.ID,
          books.title as books_title
        }
      `)
  })

  it('in having, one assoc, one field', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID } having author.name = 'Schiller'`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books
        left outer join bookshop.Authors as author on author.ID = Books.author_ID
        { Books.ID } having author.name = 'Schiller'
      `)
  })

  it('in select & having, same assoc', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Books as Books { ID, author.name } having author.placeOfBirth = 'Marbach'`,
      model,
    )
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books
        left outer join bookshop.Authors as author on author.ID = Books.author_ID
        { Books.ID, author.name as author_name } having author.placeOfBirth = 'Marbach'
      `)
  })
  it('in select & having, same assoc with same filter -> only one join', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Books as Books { ID, author[placeOfBirth='Marbach'].name } having author[placeOfBirth='Marbach'].name = 'King'`,
      model,
    )
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books
        left outer join bookshop.Authors as author on author.ID = Books.author_ID and author.placeOfBirth = 'Marbach'
        { Books.ID, author.name as author_name } having author.name = 'King'
      `)
  })

  it('in group by, one assoc, one field', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID } group by author.name`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books
        left outer join bookshop.Authors as author on author.ID = Books.author_ID
        { Books.ID } group by author.name
      `)
  })
  it('in order by, one assoc, one field', () => {
    const input = cds.ql`SELECT from bookshop.Books as Books { ID } order by author.name asc`
    let query = cqn4sql(input, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books
        left outer join bookshop.Authors as author on author.ID = Books.author_ID
        { Books.ID } order by author.name asc
      `)
  })
  it('in order by, via wildcard', () => {
    const input = cds.ql`SELECT from bookshop.Books.twin as twin order by author.name asc`
    let query = cqn4sql(input, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books.twin as twin
        left outer join bookshop.Authors as author on author.ID = twin.author_ID
        { twin.ID, twin.author_ID, twin.stock } order by author.name asc
      `)
  })
  it('in group by, one assoc, wildcard select', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books as Books group by author.name`, model)
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books
        left outer join bookshop.Authors as author on author.ID = Books.author_ID
        {
        Books.createdAt,
        Books.createdBy,
        Books.modifiedAt,
        Books.modifiedBy,
        Books.ID,
        Books.anotherText,
        Books.title,
        Books.descr,
        Books.author_ID,
        Books.coAuthor_ID,
        Books.genre_ID,
        Books.stock,
        Books.price,
        Books.currency_code,
        Books.dedication_addressee_ID,
        Books.dedication_text,
        Books.dedication_sub_foo,
        Books.dedication_dedication,
        Books.coAuthor_ID_unmanaged,
        } group by author.name
      `)
  })

  it('properly rewrite association chains if intermediate assoc is not fk', () => {
    // this issue came up for ref: [genre.parent.ID] because "ID" is fk of "parent"
    // but "parent" is not fk of "genre"
    const q = cds.ql`SELECT from (select genre, ID from bookshop.Books as Books) as book {
      ID
    } group by genre.parent.ID, genre.parent.name`
    const qx = cds.ql`
    SELECT from (select Books.genre_ID, Books.ID from bookshop.Books as Books) as book
                                left join bookshop.Genres as genre on genre.ID = book.genre_ID
                                left join bookshop.Genres as parent on parent.ID = genre.parent_ID
    {
      book.ID
    } group by parent.ID, parent.name`
    const res = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.eql(qx)
  })

  // some notes for later:
  //   what if only field we fetch from assoc target is virtual? -> make join, but don't fetch anything (?)
})

describe('Variations on ON', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  it('unmanaged 1', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID, coAuthorUnmanaged.name }`, model)
    const expected = cds.ql`SELECT from bookshop.Books as Books
        left outer join bookshop.Authors as coAuthorUnmanaged
          on coAuthorUnmanaged.ID = Books.coAuthor_ID_unmanaged
        { Books.ID, coAuthorUnmanaged.name as coAuthorUnmanaged_name }
      `
    expect(query).to.deep.equal(expected)
  })

  it('unmanaged 2', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Baz as Baz { id, parent.id as pid }`, model)
    const expected = cds.ql`SELECT from bookshop.Baz as Baz
        left outer join bookshop.Baz as parent
          on parent.id = Baz.parent_id or parent.id > 17
        { Baz.id, parent.id as pid }
      `
    expect(query).to.deep.equal(expected)
  })

  // TODO (SMW) original ON condition must be enclosed in parens if there is a filter
  it('unmanaged 2 plus filter', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Baz as Baz { id, parent[id < 19].id as pid }`, model)
    const expected = cds.ql`SELECT from bookshop.Baz as Baz
        left outer join bookshop.Baz as parent
          on (parent.id = Baz.parent_id or parent.id > 17) and parent.id < 19
        { Baz.id, parent.id as pid }
      `
    expect(query).to.deep.equal(expected)
  })

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

  it('unmanaged assoc with on condition with length === 1', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.BooksWithWeirdOnConditions as BooksWithWeirdOnConditions { ID, onlyOneRef.foo }`,
      model,
    )
    const expected = cds.ql`SELECT from bookshop.BooksWithWeirdOnConditions as BooksWithWeirdOnConditions
        left outer join bookshop.BooksWithWeirdOnConditions as onlyOneRef on BooksWithWeirdOnConditions.ID
        { BooksWithWeirdOnConditions.ID, onlyOneRef.foo as onlyOneRef_foo }
      `
    expect(query).to.deep.equal(expected)
  })
  it('unmanaged assoc with on condition with odd length', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.BooksWithWeirdOnConditions as BooksWithWeirdOnConditions { ID, oddNumber.foo }`,
      model,
    )
    const expected = cds.ql`SELECT from bookshop.BooksWithWeirdOnConditions as BooksWithWeirdOnConditions
        left outer join bookshop.BooksWithWeirdOnConditions as oddNumber on BooksWithWeirdOnConditions.foo / 5 + BooksWithWeirdOnConditions.ID = BooksWithWeirdOnConditions.ID + BooksWithWeirdOnConditions.foo
        { BooksWithWeirdOnConditions.ID, oddNumber.foo as oddNumber_foo }
      `
    expect(query).to.deep.equal(expected)
  })
  it('unmanaged assoc with on condition accessing structured foreign keys', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.BooksWithWeirdOnConditions as BooksWithWeirdOnConditions { ID, oddNumberWithForeignKeyAccess.second }`,
      model,
    )
    const expected = cds.ql`SELECT from bookshop.BooksWithWeirdOnConditions as BooksWithWeirdOnConditions
    left outer join bookshop.WithStructuredKey as oddNumberWithForeignKeyAccess on oddNumberWithForeignKeyAccess.struct_mid_anotherLeaf = oddNumberWithForeignKeyAccess.struct_mid_leaf / oddNumberWithForeignKeyAccess.second
    { BooksWithWeirdOnConditions.ID, oddNumberWithForeignKeyAccess.second as oddNumberWithForeignKeyAccess_second }
      `
    expect(query).to.deep.equal(expected)
  })
  it('unmanaged assoc with on condition comparing to val', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.BooksWithWeirdOnConditions as BooksWithWeirdOnConditions { ID, refComparedToVal.refComparedToValFlipped.foo }`,
      model,
    )
    const expected = cds.ql`SELECT from bookshop.BooksWithWeirdOnConditions as BooksWithWeirdOnConditions
        left outer join bookshop.BooksWithWeirdOnConditions as refComparedToVal on BooksWithWeirdOnConditions.ID != 1
        left outer join bookshop.BooksWithWeirdOnConditions as refComparedToValFlipped on 1 != refComparedToVal.ID
        { BooksWithWeirdOnConditions.ID, refComparedToValFlipped.foo as refComparedToVal_refComparedToValFlipped_foo }
      `
    expect(query).to.deep.equal(expected)
  })

  it('accessing partial key after association implies join if not part of explicit FK', () => {
    const original = cds.ql`SELECT from bookshop.PartialStructuredKey as PartialStructuredKey { toSelf.struct.one, toSelf.struct.two }`
    const transformed = cqn4sql(original, model)
    const expected = cds.ql`SELECT from bookshop.PartialStructuredKey as PartialStructuredKey
        left outer join bookshop.PartialStructuredKey as toSelf on toSelf.struct_one = PartialStructuredKey.toSelf_partial
        {
          PartialStructuredKey.toSelf_partial as toSelf_struct_one,
          toSelf.struct_two as toSelf_struct_two
        }
      `
    // inferred element name equals original ref navigation
    expect(transformed.elements).to.have.property('toSelf_struct_one')
    expect(transformed).to.deep.equal(expected)
  })
})

describe('subqueries in from', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  it('in select, use one assoc in FROM subquery', () => {
    let query = cqn4sql(
      cds.ql`SELECT from (SELECT from bookshop.Books as Books { author.name as author_name  }) as Bar { Bar.author_name }`,
      model,
    )
    const expected = cds.ql`SELECT from (
        SELECT from bookshop.Books as Books
        left outer join bookshop.Authors as author on author.ID = Books.author_ID
         { author.name as author_name }
      ) as Bar { Bar.author_name }
      `
    expect(query).to.deep.equal(expected)
  })

  it('expose managed assoc in FROM subquery, expose in main select', () => {
    let query = cqn4sql(
      cds.ql`SELECT from (SELECT from bookshop.Books as Books { author }) as Bar { Bar.author }`,
      model,
    )
    const expected = cds.ql`SELECT from (
        SELECT from bookshop.Books as Books { Books.author_ID }
      ) as Bar { Bar.author_ID }
      `
    expect(query).to.deep.equal(expected)
  })

  it('expose managed assoc in FROM subquery with alias, expose in main select', () => {
    let query = cqn4sql(
      cds.ql`SELECT from (SELECT from bookshop.Books as Books { author as a }) as Bar { Bar.a }`,
      model,
    )
    const expected = cds.ql`SELECT from (
        SELECT from bookshop.Books as Books { Books.author_ID as a_ID }
      ) as Bar { Bar.a_ID }
      `
    expect(query).to.deep.equal(expected)
  })

  // If a FROM subquery only _exposes_ an association which is then used in the main query,
  // the JOIN happens in the main query.
  it('expose managed assoc in FROM subquery, use in main select', () => {
    let query = cqn4sql(
      cds.ql`SELECT from (SELECT from bookshop.Books as Books { author }) as Bar
        { Bar.author.name }`,
      model,
    )
    const expected = cds.ql`SELECT from (
          SELECT from bookshop.Books as Books { Books.author_ID }
        ) as Bar
        left outer join bookshop.Authors as author on author.ID = Bar.author_ID
        { author.name as author_name }
      `
    expect(query).to.deep.equal(expected)
  })

  it('expose managed assoc with alias in FROM subquery, use in main select', () => {
    let query = cqn4sql(
      cds.ql`SELECT from (SELECT from bookshop.Books { author as a}) as Bar
        { Bar.a.name }`,
      model,
    )
    const expected = cds.ql`SELECT from (
          SELECT from bookshop.Books as $B { $B.author_ID as a_ID }
        ) as Bar
        left outer join bookshop.Authors as a on a.ID = Bar.a_ID
        { a.name as a_name }
      `
    expect(query).to.deep.equal(expected)
  })

  // TODO (SMW) check again ...
  it('in select, assoc exposure multiple joins in subquery', () => {
    let query = cqn4sql(
      cds.ql`SELECT from (SELECT from bookshop.Books { author.ID, author as a, author.name as author_name  }) as Bar
        { Bar.author_name, Bar.a.books.descr }`,
      model,
    )
    const expected = cds.ql`SELECT from (
          SELECT from bookshop.Books as $B
            left outer join bookshop.Authors as author on author.ID = $B.author_ID
          { $B.author_ID, $B.author_ID as a_ID, author.name as author_name }
        ) as Bar
        left outer join bookshop.Authors as a on a.ID = Bar.a_ID
        left outer join bookshop.Books as books on books.author_ID = a.ID
        { Bar.author_name, books.descr as a_books_descr}
      `
    expect(query).to.deep.equal(expected)
  })

  // (SMW) new
  // TODO move to extra section?
  it('assoc path in value subquery', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Books as Books {
          title,
          (select from bookshop.Genres as Genres { parent.code } where Genres.ID = Books.genre.ID) as pc
        }`,
      model,
    )
    const expected = cds.ql`SELECT from bookshop.Books as Books
        {
          Books.title,
          (select from bookshop.Genres as Genres left outer join bookshop.Genres as parent
             on parent.ID = Genres.parent_ID
            { parent.code as parent_code } where Genres.ID = Books.genre_ID) as pc
        }
      `
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(expected)
  })
})

describe('Backlink Associations', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/model/A2J/schema').then(cds.linked)
  })
  it('self managed', () => {
    let query = cqn4sql(
      cds.ql`select from a2j.Header as Header {
        toItem_selfMgd.id,
      }`,
      model,
    )
    expect(query).to.deep.equal(cds.ql`SELECT from a2j.Header as Header
        left outer join a2j.Item as toItem_selfMgd on toItem_selfMgd.toHeader_id = Header.id and toItem_selfMgd.toHeader_id2 = Header.id2
        { toItem_selfMgd.id as toItem_selfMgd_id}
      `)
  })

  it('self unmanaged', () => {
    let query = cqn4sql(
      cds.ql`select from a2j.Header as Header {
        toItem_selfUmgd.id,
      }`,
      model,
    )
    const expected = cds.ql`SELECT from a2j.Header as Header
        left outer join a2j.Item as toItem_selfUmgd on (toItem_selfUmgd.elt2 = Header.elt)
        { toItem_selfUmgd.id as toItem_selfUmgd_id}
      `
    expect(query).to.deep.equal(expected)
  })

  it('self combined', () => {
    let query = cqn4sql(
      cds.ql`select from a2j.Header as Header {
        toItem_combined.id,
      }`,
      model,
    )
    const expected = cds.ql`SELECT from a2j.Header as Header
        left outer join a2j.Item as toItem_combined
          on (
                  (toItem_combined.toHeader_id = Header.id and toItem_combined.toHeader_id2 = Header.id2)
                  OR
                  (toItem_combined.elt2 = Header.elt)
             ) and 5 != 4
        { toItem_combined.id as toItem_combined_id}
      `
    expect(query).to.deep.equal(expected)
  })

  it('forward', () => {
    let query = cqn4sql(
      cds.ql`select from a2j.Header as Header {
        toItem_fwd.id,
      }`,
      model,
    )
    const expected = cds.ql`SELECT from a2j.Header as Header
        left outer join a2j.Item as toItem_fwd on Header.id = toItem_fwd.id
        { toItem_fwd.id as toItem_fwd_id}
      `
    expect(query).to.deep.equal(expected)
  })

  it('all of the above combined', () => {
    let query = cqn4sql(
      cds.ql`select from a2j.Header as Header {
        toItem_selfMgd.id as selfMgd_id,
        toItem_selfUmgd.id as selfUmgd_id,
        toItem_combined.id as combined_id,
        toItem_fwd.id as direct_id
      }`,
      model,
    )
    const expected = cds.ql`SELECT from a2j.Header as Header
        left outer join a2j.Item as toItem_selfMgd
          on toItem_selfMgd.toHeader_id = Header.id and toItem_selfMgd.toHeader_id2 = Header.id2
        left outer join a2j.Item as toItem_selfUmgd
          on toItem_selfUmgd.elt2 = Header.elt
        left outer join a2j.Item as toItem_combined
          on ((toItem_combined.toHeader_id = Header.id and toItem_combined.toHeader_id2 = Header.id2) OR (toItem_combined.elt2 = Header.elt)) and 5 != 4
        left outer join a2j.Item as toItem_fwd
          on Header.id = toItem_fwd.id
        {
          toItem_selfMgd.id as selfMgd_id,
          toItem_selfUmgd.id as selfUmgd_id,
          toItem_combined.id as combined_id,
          toItem_fwd.id as direct_id
        }
      `
    expect(query).to.deep.equal(expected)
  })

  it('backlink usage', () => {
    let query = cqn4sql(
      cds.ql`select from a2j.Folder as Folder {
        nodeCompanyCode.assignments.data
      }`,
      model,
    )

    const expected = cds.ql`SELECT from a2j.Folder as Folder
      left outer join a2j.Folder as nodeCompanyCode on nodeCompanyCode.id = Folder.nodeCompanyCode_id
      left outer join a2j.Assignment as assignments on assignments.toFolder_id = nodeCompanyCode.id
        {
          assignments.data as nodeCompanyCode_assignments_data
        }
      `
    expect(query).to.deep.equal(expected)
  })

  // compiler generates '$user.id' // cqn4sql generates `ref: ['$user', 'id']`
  it('Backlinks with other items in same on-condition', () => {
    let query = cqn4sql(
      cds.ql`select from a2j.F as F {
        toE.data
      }`,
      model,
    )

    const expected = cds.ql`select from a2j.F as F
      left outer join a2j.E as toE on (toE.toF_id = F.id) and
      toE.id = $user.id
      {
        toE.data as toE_data
      }
      `
    expect(query).to.deep.equal(expected)
  })
})

describe('Shared foreign key identity', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/model/A2J/sharedFKIdentity').then(cds.linked)
  })
  it('identifies FKs following toB', () => {
    let query = cqn4sql(
      cds.ql`select from A as A {
        a.b.c.toB.b.c.d.parent.c.d.e.ID  as a_b_c_toB_foo_boo,
        a.b.c.toB.e.f.g.child.c.d.e.ID  as a_b_c_toB_bar_bas
      }`,
      model,
    )
    expect(query).to.deep.equal(cds.ql`SELECT from A as A
        {
          A.a_b_c_toB_foo_boo AS a_b_c_toB_foo_boo,
          A.a_b_c_toB_bar_bas AS a_b_c_toB_bar_bas
        }
      `)
  })
})

describe('Where exists in combination with assoc to join', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  it('one assoc + one where exists / aliases are treated case insensitive', () => {
    let query = cqn4sql(
      cds.ql`select from bookshop.Books:author as author {
      books.genre.name,
    }`,
      model,
    )
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as author
      left outer join bookshop.Books as books on books.author_ID = author.ID
      left outer join bookshop.Genres as genre on genre.ID = books.genre_ID
      { genre.name as books_genre_name } where exists (
        SELECT 1 from bookshop.Books as $B where $B.author_ID = author.ID
      )
    `)
  })
  it('aliases for recursive assoc in column + recursive assoc in from must not clash', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Authors:books.genre.parent.parent.parent as parent
      { parent.parent.parent.descr, }`,
      model,
    )
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Genres as parent
    left outer join bookshop.Genres as parent2 on parent2.ID = parent.parent_ID
    left outer join bookshop.Genres as parent3 on parent3.ID = parent2.parent_ID
    {
      parent3.descr as parent_parent_descr,
    }
    WHERE EXISTS (
      SELECT 1 from bookshop.Genres as $p where $p.parent_ID = parent.ID and EXISTS (
        SELECT 1 from bookshop.Genres as $p2 where $p2.parent_ID = $p.ID and EXISTS (
          SELECT 1 from bookshop.Genres as $g where $g.parent_ID = $p2.ID and EXISTS (
            SELECT 1 from bookshop.Books as $b where $b.genre_ID = $g.ID and EXISTS (
              SELECT 1 from bookshop.Authors as $A where $A.ID = $b.author_ID
            )
          )
        )
      )
    )`)
  })

  // Revisit: Alias count order in where + from could be flipped
  it('aliases for recursive assoc in column + recursive assoc in from + where exists <assoc> must not clash', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Authors:books.genre.parent.parent.parent as parent
      { parent.parent.parent.descr } where exists parent`,
      model,
    )
    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Genres as parent
    left outer join bookshop.Genres as parent2 on parent2.ID = parent.parent_ID
    left outer join bookshop.Genres as parent3 on parent3.ID = parent2.parent_ID
    {
      parent3.descr as parent_parent_descr,
    }
    WHERE EXISTS (
      SELECT 1 from bookshop.Genres as $p2 where $p2.parent_ID = parent.ID and EXISTS (
        SELECT 1 from bookshop.Genres as $p3 where $p3.parent_ID = $p2.ID and EXISTS (
          SELECT 1 from bookshop.Genres as $g where $g.parent_ID = $p3.ID and EXISTS (
            SELECT 1 from bookshop.Books as $b where $b.genre_ID = $g.ID and EXISTS (
              SELECT 1 from bookshop.Authors as $A where $A.ID = $b.author_ID
            )
          )
        )
      )
    ) and EXISTS (
      SELECT 1 from bookshop.Genres as $p where $p.ID = parent.parent_ID
    )`)
  })
})

describe('comparisons of associations in on condition of elements needs to be expanded', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/model/A2J/schema').then(cds.linked)
  })

  it('assoc comparison needs to be expanded in on condition calculation', () => {
    const query = cqn4sql(cds.ql`SELECT from a2j.Foo as Foo { ID, buz.foo }`, model)
    const expected = cds.ql`
      SELECT from a2j.Foo as Foo left join a2j.Buz as buz on ((buz.bar_ID = Foo.bar_ID AND buz.bar_foo_ID = Foo.bar_foo_ID) and buz.foo_ID = Foo.ID){
        Foo.ID,
        buz.foo_ID as buz_foo_ID
      }`
    expect(query).to.eql(expected)
  })
  it('unmanaged association path traversal in on condition needs to be flattened', () => {
    const query = cqn4sql(cds.ql`SELECT from a2j.Foo as Foo { ID, buzUnmanaged.foo }`, model)
    const expected = cds.ql`
      SELECT from a2j.Foo as Foo left join a2j.Buz as buzUnmanaged
        on buzUnmanaged.bar_foo_ID = Foo.bar_foo_ID and buzUnmanaged.bar_ID = Foo.bar_ID and buzUnmanaged.foo_ID = Foo.ID
      {
        Foo.ID,
        buzUnmanaged.foo_ID as buzUnmanaged_foo_ID
      }`
    expect(query).to.eql(expected)
  })
})

describe('optimize fk access', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/model/A2J/classes').then(cds.linked)
  })
  it('association (with multiple, structured, renamed fks) is key', () => {
    const query = cds.ql`SELECT from ForeignKeyIsAssoc as ForeignKeyIsAssoc {
      my.room as teachersRoom,
    }`
    const expected = cds.ql`SELECT from ForeignKeyIsAssoc as ForeignKeyIsAssoc {
                          ForeignKeyIsAssoc.my_room_number as teachersRoom_number,
                          ForeignKeyIsAssoc.my_room_name as teachersRoom_name,
                          ForeignKeyIsAssoc.my_room_location as teachersRoom_info_location
                        }`

    expect(cqn4sql(query, model)).to.deep.equal(expected)
  })
  it('association as key leads to non-key field', () => {
    const query = cds.ql`SELECT from Pupils as Pupils {
      ID
    } group by classrooms.classroom.ID, classrooms.classroom.name`
    const expected = cds.ql`SELECT from Pupils as Pupils
                        left join ClassroomsPupils as classrooms
                          on classrooms.pupil_ID = Pupils.ID
                        left join Classrooms as classroom
                          on classroom.ID = classrooms.classroom_ID
                        {
                          Pupils.ID
                        } group by classroom.ID, classroom.name`

    expect(cqn4sql(query, model)).to.deep.equal(expected)
  })
  it('association as key leads to nested non-key field', () => {
    const query = cds.ql`SELECT from Pupils as Pupils {
      ID
    } group by classrooms.classroom.ID, classrooms.classroom.info.capacity`
    const expected = cds.ql`SELECT from Pupils as Pupils
                        left join ClassroomsPupils as classrooms
                          on classrooms.pupil_ID = Pupils.ID
                        left join Classrooms as classroom
                          on classroom.ID = classrooms.classroom_ID
                        {
                          Pupils.ID
                        } group by classroom.ID, classroom.info_capacity`

    expect(cqn4sql(query, model)).to.deep.equal(expected)
  })
  it('two step path ends in foreign key simple ref', () => {
    const query = cds.ql`SELECT from Classrooms as Classrooms {
      pupils.pupil.ID as studentCount,
    } where Classrooms.ID = 1`
    const expected = cds.ql`SELECT from Classrooms as Classrooms left join ClassroomsPupils as pupils
                        on pupils.classroom_ID = Classrooms.ID {
                          pupils.pupil_ID as studentCount
                        } where Classrooms.ID = 1`

    expect(cqn4sql(query, model)).to.deep.equal(expected)
  })
  it('filters are always join relevant', () => {
    const query = cds.ql`SELECT from ClassroomsPupils as ClassroomsPupils {
      pupil[ID = 5].ID as student,
    }`
    const expected = cds.ql`SELECT from ClassroomsPupils as ClassroomsPupils
                          left join Pupils as pupil on pupil.ID = ClassroomsPupils.pupil_ID
                          and pupil.ID = 5
                        {
                          pupil.ID as student
                        }`

    expect(cqn4sql(query, model)).to.deep.equal(expected)
  })
  it('optimized next to non-optimized', () => {
    const query = cds.ql`SELECT from ClassroomsPupils as ClassroomsPupils {
      pupil[ID = 5].ID as nonOptimized,
      pupil.ID as optimized,
    }`
    const expected = cds.ql`SELECT from ClassroomsPupils as ClassroomsPupils
                          left join Pupils as pupil on pupil.ID = ClassroomsPupils.pupil_ID
                          and pupil.ID = 5
                        {
                          pupil.ID as nonOptimized,
                          ClassroomsPupils.pupil_ID as optimized
                        }`

    expect(cqn4sql(query, model)).to.deep.equal(expected)
  })
  it('optimized next to join relevant', () => {
    const query = cds.ql`SELECT from ClassroomsPupils as ClassroomsPupils {
      classroom.ID as classroom_ID,
      classroom.name as classroom,
    }`
    const expected = cds.ql`SELECT from ClassroomsPupils as ClassroomsPupils
                          left join Classrooms as classroom on classroom.ID = ClassroomsPupils.classroom_ID
                        {
                          ClassroomsPupils.classroom_ID as classroom_ID,
                          classroom.name as classroom
                        }`

    expect(cqn4sql(query, model)).to.deep.equal(expected)
  })
  it('two step path ends in foreign key simple ref in aggregation clauses', () => {
    const query = cds.ql`SELECT from Classrooms as Classrooms {
      pupils.pupil.ID as studentCount,
    }
      where pupils.pupil.ID = 1
      group by pupils.pupil.ID
      having pupils.pupil.ID = 1
      order by pupils.pupil.ID
    `
    const expected = cds.ql`SELECT from Classrooms as Classrooms left join ClassroomsPupils as pupils
                        on pupils.classroom_ID = Classrooms.ID {
                          pupils.pupil_ID as studentCount
                        } where pupils.pupil_ID = 1
                          group by pupils.pupil_ID
                          having pupils.pupil_ID = 1
                          order by pupils.pupil_ID
                        `

    expect(cqn4sql(query, model)).to.deep.equal(expected)
  })
  it('two step path ends in foreign key nested ref', () => {
    const query = cds.ql`SELECT from Classrooms as Classrooms{
      count(pupils.pupil.ID) as studentCount,
    } where Classrooms.ID = 1`
    const expected = cds.ql`SELECT from Classrooms as Classrooms left join ClassroomsPupils as pupils
                        on pupils.classroom_ID = Classrooms.ID {
                          count(pupils.pupil_ID) as studentCount
                        } where Classrooms.ID = 1`

    expect(cqn4sql(query, model)).to.deep.equal(expected)
  })

  it('multi step path ends in foreign key', () => {
    const query = cds.ql`SELECT from Classrooms as Classrooms {
      count(pupils.pupil.classrooms.classroom.ID) as classCount,
    } where    pupils.pupil.classrooms.classroom.ID = 1
      order by pupils.pupil.classrooms.classroom.ID`
    const expected = cds.ql`SELECT from Classrooms as Classrooms
                        left join ClassroomsPupils as pupils on pupils.classroom_ID = Classrooms.ID
                        left join Pupils as pupil on pupil.ID = pupils.pupil_ID
                        left join ClassroomsPupils as classrooms2 on classrooms2.pupil_ID = pupil.ID
                        {
                          count(classrooms2.classroom_ID) as classCount
                        } where    classrooms2.classroom_ID = 1
                          order by classrooms2.classroom_ID`

    expect(cqn4sql(query, model)).to.deep.equal(expected)
  })
})

describe('References to target side via dummy filter', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/model/A2J/TargetSideReferences').then(cds.linked)
  })

  it('foreign keys, no joins', () => {
    const query = cds.ql`
    SELECT from S.Source {
      toMid.toTarget.toSource.sourceID as foreignKey,
      toMid.{ toTarget.{ toSource.{ sourceID as inlineForeignKey } } },
    }`

    const expected = cds.ql`
    SELECT from S.Source as $S {
      $S.toMid_toTarget_toSource_sourceID as foreignKey,
      $S.toMid_toTarget_toSource_sourceID as toMid_toTarget_toSource_inlineForeignKey
    }`
    expect(cqn4sql(query, model)).to.deep.equal(expected)
  })

  it('Shared join nodes', () => {
    const query = cds.ql`
    SELECT from S.Source {
      toMid.toTarget.toSource.sourceID as fullForeignKey,
      toMid[1=1].toTarget.toSource.sourceID as foreignKeyAfterToMid,
      toMid[1=1].toTarget[1=1].toSource.sourceID as foreignKeyAfterToTarget,
      toMid[1=1].toTarget[1=1].toSource[1=1].sourceID as targetsKeyAfterToSource
    }`

    // REVISIT: toTarget2 should just be toTarget, alias calculation gets messy here..
    //          toSource3 should just be toSource
    const expected = cds.ql`
    SELECT from S.Source as $S
      left join S.Mid as toMid on toMid.toTarget_toSource_sourceID = $S.toMid_toTarget_toSource_sourceID and 1 = 1
      left join S.Target as toTarget2 on toTarget2.toSource_sourceID = toMid.toTarget_toSource_sourceID and 1 = 1
      left join S.Source as toSource3 on toSource3.sourceID = toTarget2.toSource_sourceID and 1 = 1
    {
      $S.toMid_toTarget_toSource_sourceID as fullForeignKey,
      toMid.toTarget_toSource_sourceID as foreignKeyAfterToMid,
      toTarget2.toSource_sourceID as foreignKeyAfterToTarget,
      toSource3.sourceID as targetsKeyAfterToSource
    }
    `
    const transformed = cqn4sql(query, model)
    expect(transformed).to.deep.equal(expected)
  })

  it('Own join nodes', () => {
    const query = cds.ql`
    SELECT from S.Source {
      toMid.toTarget.toSource.sourceID as fullForeignKey,
      toMid[1=1].toTarget.toSource.sourceID as foreignKeyAfterToMid,
      toMid.toTarget[1=1].toSource.sourceID as foreignKeyAfterToTarget,
      toMid.toTarget.toSource[1=1].sourceID as targetsKeyAfterToSource
    }`

    const expected = cds.ql`
    SELECT from S.Source as $S
      left join S.Mid as toMid on toMid.toTarget_toSource_sourceID = $S.toMid_toTarget_toSource_sourceID and 1 = 1
      
      left join S.Mid as toMid2 on toMid2.toTarget_toSource_sourceID = $S.toMid_toTarget_toSource_sourceID
      left join S.Target as toTarget2 on toTarget2.toSource_sourceID = toMid2.toTarget_toSource_sourceID and 1 = 1

      left join S.Target as toTarget3 on toTarget3.toSource_sourceID = toMid2.toTarget_toSource_sourceID
      left join S.Source as toSource3 on toSource3.sourceID = toTarget3.toSource_sourceID and 1 = 1
    {
      $S.toMid_toTarget_toSource_sourceID as fullForeignKey,
      toMid.toTarget_toSource_sourceID as foreignKeyAfterToMid,
      toTarget2.toSource_sourceID as foreignKeyAfterToTarget,
      toSource3.sourceID as targetsKeyAfterToSource
    }
    `
    const transformed = cqn4sql(query, model)
    expect(transformed).to.deep.equal(expected)
  })

  it('Own join nodes with roundtrip', () => {
    // TODO: toMid.toTarget.toSource[1=1].toMid.toTarget.toSource.sourceID as third
    const query = cds.ql`
    SELECT from S.Source {
      toMid[1 = 1].toTarget.toSource.toMid.toTarget.toSource.sourceID as first,
      toMid.toTarget[1=1].toSource.toMid.toTarget.toSource.sourceID as second
    }`

    const expected = cds.ql`
    SELECT from S.Source as $S
      left join S.Mid as toMid on toMid.toTarget_toSource_sourceID = $S.toMid_toTarget_toSource_sourceID and 1 = 1
      left join S.Target as toTarget on toTarget.toSource_sourceID = toMid.toTarget_toSource_sourceID
      left join S.Source as toSource on toSource.sourceID = toTarget.toSource_sourceID

      left join S.Mid as toMid3 on toMid3.toTarget_toSource_sourceID = $S.toMid_toTarget_toSource_sourceID
      left join S.Target as toTarget3 on toTarget3.toSource_sourceID = toMid3.toTarget_toSource_sourceID and 1 = 1
      left join S.Source as toSource3 on toSource3.sourceID = toTarget3.toSource_sourceID

    {
      toSource.toMid_toTarget_toSource_sourceID as first,
      toSource3.toMid_toTarget_toSource_sourceID as second
    }
    `

    expect(cqn4sql(query, model)).to.deep.equal(expected)
  })

  it('Shared base joins with round-trips', () => {
    const query = cds.ql`
    SELECT from S.Source {
      toMid.toTarget.toSource.sourceID as fullForeignKey,
      toMid.toTarget.toSource.toMid[1=1].toTarget.toSource.sourceID as foreignKeyAfterToMid,
      toMid.toTarget.toSource.toMid.toTarget[1=1].toSource.sourceID as foreignKeyAfterToTarget,
      toMid.toTarget.toSource.toMid.toTarget.toSource[1=1].sourceID as targetsKeyAfterToSource
    }`

    // everything up to `toSource` can be used by all columns
    // own join for `toMid` in column `foreignKeyAfterToTarget` (join `toMid3` is re-used by `targetsKeyAfterToSource`)
    // own join for `toTarget` in column `targetsKeyAfterToSource` (without the filter)

    const expected = cds.ql`
    SELECT from S.Source as $S
      left join S.Mid as toMid on toMid.toTarget_toSource_sourceID = $S.toMid_toTarget_toSource_sourceID
      left join S.Target as toTarget on toTarget.toSource_sourceID = toMid.toTarget_toSource_sourceID
      left join S.Source as toSource on toSource.sourceID = toTarget.toSource_sourceID
      left join S.Mid as toMid2 on toMid2.toTarget_toSource_sourceID = toSource.toMid_toTarget_toSource_sourceID and 1 = 1

      left join S.Mid as toMid3 on toMid3.toTarget_toSource_sourceID = toSource.toMid_toTarget_toSource_sourceID
      left join S.Target as toTarget3 on toTarget3.toSource_sourceID = toMid3.toTarget_toSource_sourceID and 1 = 1

      left join S.Target as toTarget4 on toTarget4.toSource_sourceID = toMid3.toTarget_toSource_sourceID
      left join S.Source as toSource4 on toSource4.sourceID = toTarget4.toSource_sourceID and 1 = 1
    {
      $S.toMid_toTarget_toSource_sourceID as fullForeignKey,
      toMid2.toTarget_toSource_sourceID as foreignKeyAfterToMid,
      toTarget3.toSource_sourceID as foreignKeyAfterToTarget,
      toSource4.sourceID as targetsKeyAfterToSource
    }
    `
    const transformed = cqn4sql(query, model)
    expect(transformed).to.deep.equal(expected)
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
    const q = cds.ql`SELECT from S.Books as Books {
      authorAddress.address as assocAsForeignKey
    }`
    const expected = cds.ql`SELECT from S.Books as Books {
      Books.authorAddress_address_street as assocAsForeignKey_street,
      Books.authorAddress_address_number as assocAsForeignKey_number,
      Books.authorAddress_address_zip as assocAsForeignKey_zip,
      Books.authorAddress_address_city as assocAsForeignKey_city,
    }`

    expect(cqn4sql(q, model)).to.deep.equal(expected)
  })

  it('path ends on assoc which is fk, prefix is structured', () => {
    const q = cds.ql`SELECT from S.Books as Books {
      deeply.nested.authorAddress.address as deepAssocAsForeignKey
    }`
    const expected = cds.ql`SELECT from S.Books as Books {
      Books.deeply_nested_authorAddress_address_street as deepAssocAsForeignKey_street,
      Books.deeply_nested_authorAddress_address_number as deepAssocAsForeignKey_number,
      Books.deeply_nested_authorAddress_address_zip as deepAssocAsForeignKey_zip,
      Books.deeply_nested_authorAddress_address_city as deepAssocAsForeignKey_city
    }`

    expect(cqn4sql(q, model)).to.deep.equal(expected)
  })

  it('path ends on assoc which is fk, renamed', () => {
    const q = cds.ql`SELECT from S.Books as Books {
      authorAddressFKRenamed.address as renamedAssocAsForeignKey
    }`

    const expected = cds.ql`SELECT from S.Books as Books {
      Books.authorAddressFKRenamed_bar_street as renamedAssocAsForeignKey_street,
      Books.authorAddressFKRenamed_bar_number as renamedAssocAsForeignKey_number,
      Books.authorAddressFKRenamed_bar_zip as renamedAssocAsForeignKey_zip,
      Books.authorAddressFKRenamed_bar_city as renamedAssocAsForeignKey_city
    }`

    expect(cqn4sql(q, model)).to.deep.equal(expected)
  })

  it('recursive path end on deeply nested struct that contains assoc', () => {
    const q = cds.ql`SELECT from S.Books as Books {
      toSelf.deeply.nested
    }`
    const expected = cds.ql`SELECT from S.Books as Books {
      Books.toSelf_baz_authorAddress_address_street as toSelf_deeply_nested_authorAddress_street,
      Books.toSelf_baz_authorAddress_address_number as toSelf_deeply_nested_authorAddress_number,
      Books.toSelf_baz_authorAddress_address_zip as toSelf_deeply_nested_authorAddress_zip,
      Books.toSelf_baz_authorAddress_address_city as toSelf_deeply_nested_authorAddress_city
    }`

    expect(cqn4sql(q, model)).to.deep.equal(expected)
  })

  
})
