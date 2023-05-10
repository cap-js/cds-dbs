'use strict'
const cqn4sql = require('../../lib/db/sql/cqn4sql')
const cds = require('../../cds')
const { expect } = cds.test
/**
 * @TODO Review the mean tests and verify, that the resulting cqn 4 sql is valid.
 *       Especially w.r.t. to table aliases and bracing.
 */
describe('EXISTS predicate in where', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/bookshop/srv/cat-service').then(cds.linked)
  })

  describe('access association after `exists` predicate', () => {
    it('exists predicate for to-many assoc w/o alias', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Books { ID } where exists author`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Authors as author where author.ID = Books.author_ID
        )`)
    })
    it('exists predicate for assoc combined with path expression in xpr', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Books { ID } where exists author and ((author.name + 's') = 'Schillers')`, model)
      expect(query).to.deep.equal(CQL`
      SELECT from bookshop.Books as Books
        left join bookshop.Authors as author on author.ID = Books.author_ID
        {
          Books.ID
        }
      WHERE EXISTS (
        SELECT 1 from bookshop.Authors as author2 where author2.ID = Books.author_ID
        ) and ((author.name + 's') = 'Schillers')`)
    })
    it('rejects $self following exists predicate', () => {
      expect(() => cqn4sql(CQL`SELECT from bookshop.Books { ID, author } where exists $self.author`, model)).to.throw(
        'Unexpected "$self" following "exists", remove it or add a table alias instead'
      )
    })

    it('handles simple where exists with implicit table alias', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Books { ID } where exists Books.author`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Authors as author where author.ID = Books.author_ID
        )`)
    })

    it('handles simple where exists with explicit table alias', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Authors { ID } WHERE EXISTS Authors.books`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Books as books where books.author_ID = Authors.ID
        )`)
    })
    //
    // lonely association in EXISTS + variations with table alias
    // "give me all authors who have a book"
    //
    it('exists predicate for to-many assoc', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Authors { ID } WHERE EXISTS books`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Books as books where books.author_ID = Authors.ID
        )`)
    })

    it('FROM clause has explicit table alias', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Authors as A { ID } WHERE EXISTS books`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as A { A.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Books as books where books.author_ID = A.ID
        )`)
    })

    it('using explicit table alias of FROM clause', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Authors as A { ID } WHERE EXISTS A.books`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as A { A.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Books as books where books.author_ID = A.ID
        )`)
    })

    it('FROM clause has table alias with the same name as the assoc', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Authors as books { ID } WHERE EXISTS books`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as books { books.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Books as books2 where books2.author_ID = books.ID
        )`)
    })

    it('using the mean table alias of the FROM clause to access the association', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Authors as books { ID } WHERE EXISTS books.books`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as books { books.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Books as books2 where books2.author_ID = books.ID
        )`)
    })

    it('exists predicate has additional condition', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Authors { ID } WHERE exists books and name = 'Horst'`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as Authors { Authors.ID }
          WHERE exists ( select 1 from bookshop.Books as books where books.author_ID = Authors.ID )
           AND Authors.name = 'Horst'
        `)
    })
  })
  describe('wrapped in expression', () => {
    it('exists predicate in xpr combined with infix filter', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Books { ID } where ( ( exists author[name = 'Schiller'] ) + 2 ) = 'foo'`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID }
        WHERE (
          (
            EXISTS ( SELECT 1 from bookshop.Authors as author where author.ID = Books.author_ID and author.name = 'Schiller' )
          ) + 2
        ) = 'foo'`)
    })
  })

  describe('infix filter', () => {
    it('where exists to-one association with additional filter', () => {
      // note: now all source side elements are addressed with their table alias
      let query = cqn4sql(CQL`SELECT from bookshop.Books { ID } where exists author[name = 'Sanderson']`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Authors as author where author.ID = Books.author_ID and author.name = 'Sanderson'
        )`)
    })
    it('where exists to-one association with additional filter with xpr', () => {
      // note: now all source side elements are addressed with their table alias
      let query = cqn4sql(CQL`SELECT from bookshop.Books { ID } where exists author[not (name = 'Sanderson')]`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Authors as author where author.ID = Books.author_ID and not (author.name = 'Sanderson')
        )`)
    })

    it('MUST ... with simple filter', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Authors { ID } WHERE EXISTS books[title = 'ABAP Objects']`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Books as books where books.author_ID = Authors.ID AND books.title = 'ABAP Objects'
        )`)
    })

    it('MUST fail for unknown field in filter (1)', () => {
      expect(() =>
        cqn4sql(CQL`SELECT from bookshop.Authors { ID } WHERE EXISTS books[books.title = 'ABAP Objects']`, model)
      ).to.throw(/"books" not found in "books"/)
      // it would work if entity "Books" had a field called "books"
      // Done by cds.infer
    })

    it('MUST fail for unknown field in filter (2)', () => {
      expect(() =>
        cqn4sql(CQL`SELECT from bookshop.Authors { ID } WHERE EXISTS books[Authors.name = 'Horst']`, model)
      ).to.throw(/"Authors" not found in "books"/)
      //expect (query) .to.fail
    })

    it ('MUST ... access struc fields in filter', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Authors { ID } WHERE EXISTS books[dedication.text = 'For Hasso']`,
        model
      )
      // TODO original test had no before `dedication_text`
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Books as books where books.author_ID = Authors.ID AND books.dedication_text = 'For Hasso'
        )`)
    })

    // accessing FK of managed assoc in filter
    it('MUST ... access FK of managed assoc in filter', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Authors { ID } WHERE EXISTS books[dedication.addressee.ID = 29]`,
        model
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Books as books where books.author_ID = Authors.ID AND books.dedication_addressee_ID = 29
        )`)
    })

    it.skip('MUST fail if following managed assoc in filter', () => {
      expect(() =>
        cqn4sql(CQL`SELECT from bookshop.Authors { ID } WHERE EXISTS books[dedication.addressee.name = 'Hasso']`, model)
      ).to.throw()
    })

    it('MUST handle simple where exists with multiple association and also with $self backlink', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books { ID } where exists author.books[title = 'Harry Potter']`,
        model
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Authors as author where author.ID = Books.author_ID and EXISTS (
            SELECT 1 from bookshop.Books as books2 where books2.author_ID = author.ID and books2.title = 'Harry Potter'
          )
        )`)
    })

    it('MUST handle simple where exists with additional filter, shourcut notation', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Books { ID } where exists author[17]`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Authors as author where author.ID = Books.author_ID and author.ID = 17
        )`)
    })
  })

  describe('nested exists in infix filter', () => {
    it('MUST handle simple where exists with multiple association and also with $self backlink in shortcut notation', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books { ID } where exists author[exists books[title = 'Harry Potter']]`,
        model
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Authors as author where author.ID = Books.author_ID and EXISTS (
            SELECT 1 from bookshop.Books as books2 where books2.author_ID = author.ID and books2.title = 'Harry Potter'
            )
          )`)
    })

    // --> paths for exists predicates?

    // let { query2 } = cqn4sql (CQL`SELECT from bookshop.Books { ID } where exists author[exists books.title = 'Harry Potter']`, model)
    // let { query3 } = cqn4sql (CQL`SELECT from bookshop.Books { ID } where exists author[books.title = 'Harry Potter']`, model)
    // let { query4 } = cqn4sql (CQL`SELECT from bookshop.Books { ID } where exists author.books[title = 'Harry Potter']`, model)
    // let { query5 } = cqn4sql (CQL`SELECT from bookshop.Books { ID } where exists author.books.title = 'Harry Potter'`, model)

    it('MUST ... nested EXISTS with additional condition', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Authors { ID } WHERE EXISTS books[EXISTS author or title = 'Gravity']`,
        model
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE
      EXISTS
        (
          SELECT 1 from bookshop.Books as books where books.author_ID = Authors.ID AND 
          (
            EXISTS
              (
                SELECT 1 from bookshop.Authors as author where author.ID = books.author_ID
              ) or books.title = 'Gravity'
          )
        )`)
    })
    it('nested EXISTS with unmanaged assoc', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Authors { ID } WHERE EXISTS books[EXISTS coAuthorUnmanaged[EXISTS books]]`,
        model
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE
      EXISTS
        (
          SELECT 1 from bookshop.Books as books where books.author_ID = Authors.ID AND 
            EXISTS
              (
                SELECT 1 from bookshop.Authors as coAuthorUnmanaged
                  where coAuthorUnmanaged.ID = books.coAuthor_ID_unmanaged AND
                   EXISTS
                   (
                    SELECT 1 from bookshop.Books as books2 where
                      books2.author_ID = coAuthorUnmanaged.ID
                   )
              )
        )`)
    })
    it('MUST ... EXISTS with nested assoc', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Books { ID } WHERE EXISTS dedication.addressee`, model)
      expect(query).to.deep.equal(
        CQL`SELECT from bookshop.Books as Books { Books.ID }
              WHERE EXISTS (
                SELECT 1 from bookshop.Person as addressee where addressee.ID = Books.dedication_addressee_ID
              )`
      )
    })

    it('MUST ... nested EXISTS with additional condition reversed', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Authors { ID } WHERE EXISTS books[title = 'Gravity' or EXISTS author]`,
        model
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE EXISTS (
            SELECT 1 from bookshop.Books as books where 
            books.author_ID = Authors.ID AND
            ( books.title = 'Gravity' or
              EXISTS
                (
                  SELECT 1 from bookshop.Authors as author where author.ID = books.author_ID
                )
            )
          )`)
    })

    it('MUST ... 3 nested EXISTS', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Authors { ID } WHERE EXISTS books[NOT EXISTS author[EXISTS books]]`,
        model
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Books as books where books.author_ID = Authors.ID AND NOT EXISTS (
            SELECT 1 from bookshop.Authors as author where author.ID = books.author_ID AND EXISTS (
              SELECT 1 from bookshop.Books as books2 where books2.author_ID = author.ID
            )
          )
        )`)
    })

    //
    // nested EXISTS and more than one assoc
    //
    it('MUST ... 2 assocs with nested EXISTS (1)', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Authors { ID } WHERE EXISTS books[EXISTS author or title = 'Gravity'].genre[name = 'Fiction']`,
        model
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Books as books where books.author_ID = Authors.ID AND ( EXISTS (
            SELECT 1 from bookshop.Authors as author where author.ID = books.author_ID
          ) or books.title = 'Gravity' ) AND  EXISTS (
            SELECT 1 from bookshop.Genres as genre where genre.ID = books.genre_ID and genre.name = 'Fiction'
          )
        )`)
    })

    // pretty weird ...
    // `EXISTS author or title = 'Gravity'` -> filter condition is wrapped in xpr because of `OR`
    //  compare to the second exits subquery which does not need to be wrapped in xpr
    it('MUST ... 2 assocs with nested EXISTS (2)', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Authors { ID } WHERE EXISTS books[EXISTS author or title = 'Gravity'].genre[name = 'Fiction' and exists children[name = 'Foo']]`,
        model
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Books as books where books.author_ID = Authors.ID AND ( EXISTS (
            SELECT 1 from bookshop.Authors as author where author.ID = books.author_ID
          ) or books.title = 'Gravity') AND EXISTS (
            SELECT 1 from bookshop.Genres as genre where genre.ID = books.genre_ID AND genre.name = 'Fiction' AND EXISTS (
              SELECT 1 from bookshop.Genres as children where children.parent_ID = genre.ID AND children.name = 'Foo'
            )
          )
        )`)
    })
  })

  describe('navigating along associations', () => {
    //
    // more than one assoc in EXISTS
    //
    it('MUST ... with 2 assocs', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Authors { ID } WHERE EXISTS books.author`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE EXISTS (
        SELECT 1 from bookshop.Books as books where books.author_ID = Authors.ID AND EXISTS (
          SELECT 1 from bookshop.Authors as author where author.ID = books.author_ID
        )
      )`)
    })

    it('MUST ... with 4 assocs', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Authors { ID } WHERE EXISTS books.author.books.author`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE EXISTS (
        SELECT 1 from bookshop.Books as books where books.author_ID = Authors.ID AND EXISTS (
          SELECT 1 from bookshop.Authors as author where author.ID = books.author_ID AND EXISTS (
            SELECT 1 from bookshop.Books as books2 where books2.author_ID = author.ID AND EXISTS (
              SELECT 1 from bookshop.Authors as author2 where author2.ID = books2.author_ID
            )
          )
        )
      )`)
    })

    it('MUST ... adjacent EXISTS with 4 assocs each', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Authors { ID } WHERE EXISTS books.author.books.author AND EXISTS books.author.books.author`,
        model
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE EXISTS (
        SELECT 1 from bookshop.Books as books where books.author_ID = Authors.ID AND EXISTS (
          SELECT 1 from bookshop.Authors as author where author.ID = books.author_ID AND EXISTS (
            SELECT 1 from bookshop.Books as books2 where books2.author_ID = author.ID AND EXISTS (
              SELECT 1 from bookshop.Authors as author2 where author2.ID = books2.author_ID
            )
          )
        )
      ) AND EXISTS (
        SELECT 1 from bookshop.Books as books3 where books3.author_ID = Authors.ID AND EXISTS (
          SELECT 1 from bookshop.Authors as author3 where author3.ID = books3.author_ID AND EXISTS (
            SELECT 1 from bookshop.Books as books4 where books4.author_ID = author3.ID AND EXISTS (
              SELECT 1 from bookshop.Authors as author4 where author4.ID = books4.author_ID
            )
          )
        )
      )`)
    })
    it.skip('COULD use the same table aliases in independent EXISTS subqueries', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Authors { ID } WHERE EXISTS books.author.books.author AND EXISTS books.author.books.author`,
        model
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE EXISTS (
        SELECT 1 from bookshop.Books as books where author_ID = Authors.ID AND EXISTS (
          SELECT 1 from bookshop.Authors as author where ID = books.author_ID AND EXISTS (
            SELECT 1 from bookshop.Books as books2 where author_ID = author.ID AND EXISTS (
              SELECT 1 from bookshop.Authors as author2 where ID = books2.author_ID
            )
          )
        )
      ) AND EXISTS (
        SELECT 1 from bookshop.Books as books where author_ID = Authors.ID AND EXISTS (
          SELECT 1 from bookshop.Authors as author where ID = books.author_ID AND EXISTS (
            SELECT 1 from bookshop.Books as books2 where author_ID = author.ID AND EXISTS (
              SELECT 1 from bookshop.Authors as author2 where ID = books2.author_ID
            )
          )
        )
      )`)
    })

    it('MUST ... with 4 assocs and filters', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Authors { ID } WHERE EXISTS books[stock > 11].author[name = 'Horst'].books[price < 9.99].author[placeOfBirth = 'Rom']`,
        model
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE EXISTS (
        SELECT 1 from bookshop.Books as books where books.author_ID = Authors.ID AND books.stock > 11 AND EXISTS (
          SELECT 1 from bookshop.Authors as author where author.ID = books.author_ID AND author.name = 'Horst' AND EXISTS (
            SELECT 1 from bookshop.Books as books2 where books2.author_ID = author.ID AND books2.price < 9.99 AND EXISTS (
              SELECT 1 from bookshop.Authors as author2 where author2.ID = books2.author_ID AND author2.placeOfBirth = 'Rom'
            )
          )
        )
      )`)
    })

    //
    // nested EXISTS
    //
  })

  describe('inside CASE statement', () => {
    //
    // exists inside CASE
    //
    it('MUST handle simple where exists in CASE', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books {
        ID,
        case when exists author then 'yes'
             else 'no'
        end as x
       }`,
        model
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books {
        Books.ID,
        case when exists (SELECT 1 from bookshop.Authors as author where author.ID = Books.author_ID) then 'yes'
             else 'no'
        end as x
      }`)
    })

    it('MUST handle simple where exists with filter in CASE', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books {
        ID,
        case when exists author[name = 'Sanderson'] then 'yes'
             else 'no'
        end as x
       }`,
        model
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books {
        Books.ID,
        case when exists
          (
            SELECT 1 from bookshop.Authors as author where author.ID = Books.author_ID and author.name = 'Sanderson'
          ) then 'yes'
             else 'no'
        end as x
      }`)
    })

    it('exists in case with two branches', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Authors
       { ID,
         case when exists books[price>10]  then 1
              when exists books[price>100] then 2
         end as descr
       }`,
        model
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as Authors
        { Authors.ID,
          case when exists 
          (
            select 1 from bookshop.Books as books where books.author_ID = Authors.ID and books.price > 10
          )
          then 1
               when exists
               (
                  select 1 from bookshop.Books as books2 where books2.author_ID = Authors.ID and books2.price > 100
               )
               then 2
          end as descr
        }
      `)
    })
  })

  describe('association has structured keys', () => {
    //
    // association with filter in EXISTS
    //
    //
    // assocs with complicated ON
    //

    it('... managed association with structured FK', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.AssocMaze1 as AM { ID } WHERE EXISTS a_struc`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.AssocMaze1 as AM { AM.ID } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze2 as a_struc where a_struc.ID_1_a = AM.a_struc_ID_1_a and a_struc.ID_1_b = AM.a_struc_ID_1_b
                                                       and a_struc.ID_2_a = AM.a_struc_ID_2_a and a_struc.ID_2_b = AM.a_struc_ID_2_b
      )`)
    })

    it('... managed association with explicit simple FKs', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.AssocMaze1 as AM { ID } where exists a_strucX`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.AssocMaze1 as AM { AM.ID } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze2 as a_strucX where a_strucX.a = AM.a_strucX_a and a_strucX.b = AM.a_strucX_b
      )`)
    })

    it('... managed association with explicit structured FKs', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.AssocMaze1 as AM { ID } where exists a_strucY`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.AssocMaze1 as AM { AM.ID } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze2 as a_strucY where a_strucY.S_1_a = AM.a_strucY_S_1_a and a_strucY.S_1_b = AM.a_strucY_S_1_b
                                                        and a_strucY.S_2_a = AM.a_strucY_S_2_a and a_strucY.S_2_b = AM.a_strucY_S_2_b
      )`)
    })

    it('... managed association with explicit structured aliased FKs', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.AssocMaze1 as AM { ID } where exists a_strucXA`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.AssocMaze1 as AM { AM.ID } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze2 as a_strucXA where a_strucXA.S_1_a = AM.a_strucXA_T_1_a and a_strucXA.S_1_b = AM.a_strucXA_T_1_b
                                                         and a_strucXA.S_2_a = AM.a_strucXA_T_2_a and a_strucXA.S_2_b = AM.a_strucXA_T_2_b
      )`)
    })

    it('... managed associations with FKs being managed associations', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.AssocMaze1 as AM { ID } where exists a_assoc`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.AssocMaze1 as AM { AM.ID } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze3 as a_assoc where a_assoc.assoc1_ID_1_a = AM.a_assoc_assoc1_ID_1_a and a_assoc.assoc1_ID_1_b = AM.a_assoc_assoc1_ID_1_b
                                                       and a_assoc.assoc1_ID_2_a = AM.a_assoc_assoc1_ID_2_a and a_assoc.assoc1_ID_2_b = AM.a_assoc_assoc1_ID_2_b
                                                       and a_assoc.assoc2_ID_1_a = AM.a_assoc_assoc2_ID_1_a and a_assoc.assoc2_ID_1_b = AM.a_assoc_assoc2_ID_1_b
                                                       and a_assoc.assoc2_ID_2_a = AM.a_assoc_assoc2_ID_2_a and a_assoc.assoc2_ID_2_b = AM.a_assoc_assoc2_ID_2_b
      )`)
    })

    it('... managed association with explicit FKs being managed associations', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.AssocMaze1 as AM { ID } where exists a_assocY`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.AssocMaze1 as AM { AM.ID } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze2 as a_assocY where a_assocY.A_1_a = AM.a_assocY_A_1_a and a_assocY.A_1_b_ID = AM.a_assocY_A_1_b_ID
                                                        and a_assocY.A_2_a = AM.a_assocY_A_2_a and a_assocY.A_2_b_ID = AM.a_assocY_A_2_b_ID
      )`)
    })

    it('... managed association with explicit aliased FKs being managed associations', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.AssocMaze1 as AM { ID } where exists a_assocYA`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.AssocMaze1 as AM { AM.ID } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze2 as a_assocYA where a_assocYA.A_1_a = AM.a_assocYA_B_1_a and a_assocYA.A_1_b_ID = AM.a_assocYA_B_1_b_ID
                                                         and a_assocYA.A_2_a = AM.a_assocYA_B_2_a and a_assocYA.A_2_b_ID = AM.a_assocYA_B_2_b_ID
      )`)
    })

    it('... managed associations with FKs being mix of struc and managed assoc', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.AssocMaze1 as AM { ID } where exists a_strass`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.AssocMaze1 as AM { AM.ID } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze4 as a_strass where a_strass.A_1_a= AM.a_strass_A_1_a
                                                        and a_strass.A_1_b_assoc1_ID_1_a = AM.a_strass_A_1_b_assoc1_ID_1_a and a_strass.A_1_b_assoc1_ID_1_b = AM.a_strass_A_1_b_assoc1_ID_1_b
                                                        and a_strass.A_1_b_assoc1_ID_2_a = AM.a_strass_A_1_b_assoc1_ID_2_a and a_strass.A_1_b_assoc1_ID_2_b = AM.a_strass_A_1_b_assoc1_ID_2_b
                                                        and a_strass.A_1_b_assoc2_ID_1_a = AM.a_strass_A_1_b_assoc2_ID_1_a and a_strass.A_1_b_assoc2_ID_1_b = AM.a_strass_A_1_b_assoc2_ID_1_b
                                                        and a_strass.A_1_b_assoc2_ID_2_a = AM.a_strass_A_1_b_assoc2_ID_2_a and a_strass.A_1_b_assoc2_ID_2_b = AM.a_strass_A_1_b_assoc2_ID_2_b
                                                        and a_strass.A_2_a = AM.a_strass_A_2_a
                                                        and a_strass.A_2_b_assoc1_ID_1_a = AM.a_strass_A_2_b_assoc1_ID_1_a and  a_strass.A_2_b_assoc1_ID_1_b = AM.a_strass_A_2_b_assoc1_ID_1_b
                                                        and a_strass.A_2_b_assoc1_ID_2_a = AM.a_strass_A_2_b_assoc1_ID_2_a and  a_strass.A_2_b_assoc1_ID_2_b = AM.a_strass_A_2_b_assoc1_ID_2_b
                                                        and a_strass.A_2_b_assoc2_ID_1_a = AM.a_strass_A_2_b_assoc2_ID_1_a and  a_strass.A_2_b_assoc2_ID_1_b = AM.a_strass_A_2_b_assoc2_ID_1_b
                                                        and a_strass.A_2_b_assoc2_ID_2_a = AM.a_strass_A_2_b_assoc2_ID_2_a and  a_strass.A_2_b_assoc2_ID_2_b = AM.a_strass_A_2_b_assoc2_ID_2_b
      )`)
    })

    // TODO test with ...FKs being managed assoc with explicit aliased FKs
    // TODO test with ... assoc path in from with FKs being managed assoc with explicit aliased FKs

    it('... managed association with explicit FKs being path into a struc', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.AssocMaze1 as AM { ID } where exists a_part`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.AssocMaze1 as AM { AM.ID } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze2 as a_part where a_part.A_1_a = AM.a_part_a and a_part.S_2_b = AM.a_part_b
      )`)
    })
  })
})


describe('EXISTS predicate in infix filter', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/bookshop/srv/cat-service').then(cds.linked)
  })

  it('... in select', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Books {ID, genre[exists children].descr }`,
      model
    )
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Books as Books
        LEFT OUTER JOIN bookshop.Genres as genre ON genre.ID = Books.genre_ID
          and EXISTS (
            SELECT 1 from bookshop.Genres as children where children.parent_ID = genre.ID
          )
        { Books.ID, genre.descr as genre_descr }`
    )
  })

  it('... in select, nested', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Books {ID, genre[exists children[exists children]].descr }`,
      model
    )
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Books as Books
        LEFT OUTER JOIN bookshop.Genres as genre ON genre.ID = Books.genre_ID
          and EXISTS (
            SELECT 1 from bookshop.Genres as children where children.parent_ID = genre.ID
            and EXISTS (
              SELECT 1 from bookshop.Genres as children2 where children2.parent_ID = children.ID
            )
          )
        { Books.ID, genre.descr as genre_descr }`
    )
  })

  it('... in select, path with 2 assocs', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Books {ID, genre[exists children[code=2]].children[exists children[code=3]].descr }`,
      model
    )
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Books as Books
        LEFT OUTER JOIN bookshop.Genres as genre ON genre.ID = Books.genre_ID
          and EXISTS (
            SELECT 1 from bookshop.Genres as children2 where children2.parent_ID = genre.ID
            and children2.code = 2
          )
        LEFT OUTER JOIN bookshop.Genres as children ON children.parent_ID = genre.ID
          and EXISTS (
            SELECT 1 from bookshop.Genres as children3 where children3.parent_ID = children.ID
            and children3.code = 3
          )
      { Books.ID, children.descr as genre_children_descr }`
    )
  })
})

/**
 * @TODO Review the mean tests and verify, that the resulting cqn 4 sql is valid.
 *       Especially w.r.t. to table aliases and bracing.
 */
describe('Path in FROM which ends on association must be transformed to where exists', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/bookshop/srv/cat-service').then(cds.linked)
  })

  //TODO infix filter with association with structured foreign key

  //(SMW) TODO I'd prefer to have the cond from the filter before the cond coming from the WHERE
  // which, by the way, is the case in tests below where we have a path in FROM -> ???
  it('handles infix filter at entity and WHERE clause', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Books[price < 12.13]{Books.ID} where stock < 11`, model)
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Books as Books {Books.ID} WHERE (Books.stock < 11) and (Books.price < 12.13)`
    )
  })
  it('handles multiple assoc steps', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.TestPublisher:texts {ID}`, model)
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.TestPublisher.texts as texts {texts.ID} WHERE exists (
        SELECT 1 from bookshop.TestPublisher as TestPublisher where texts.publisher_structuredKey_ID = TestPublisher.publisher_structuredKey_ID
      )`
    )
  })
  it.skip('handles multiple assoc steps with renamed keys', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.TestPublisher:textsRenamedPublisher {ID}`, model)
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.TestPublisher.texts as textsRenamedPublisher {textsRenamedPublisher.ID} WHERE exists (
        SELECT 1 from bookshop.TestPublisher as TestPublisher where textsRenamedPublisher.publisherRenamedKey_notID = TestPublisher.publisherRenamedKey_notID
      )`
    )
  })

  it ('handles infix filter with nested xpr at entity and WHERE clause', () => {
    let query = cqn4sql(CQL`
      SELECT from bookshop.Books[not (price < 12.13)] { Books.ID } where stock < 11
      `, model)
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Books as Books {Books.ID} WHERE (Books.stock < 11) and (not (Books.price < 12.13))`
    )
  })

  //(SMW) TODO I'd prefer to have the cond from the filter before the cond coming from the WHERE
  // which, by the way, is the case in tests below where we have a path in FROM -> ???
  it('gets precedence right for infix filter at entity and WHERE clause', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Books[price < 12.13 or stock > 77] {Books.ID} where stock < 11 or price > 17.89`,
      model
    )
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Books as Books {Books.ID} WHERE (Books.stock < 11 or Books.price > 17.89) and (Books.price < 12.13 or Books.stock > 77)`
    )
    //expect (query) .to.deep.equal (CQL`SELECT from bookshop.Books as Books {Books.ID} WHERE (Books.price < 12.13 or Books.stock > 77) and (Books.stock < 11 or Books.price > 17.89)`)  // (SMW) want this
  })

  it('FROM path ends on to-one association', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Books:author { name }`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as author { author.name }
        WHERE EXISTS ( SELECT 1 from bookshop.Books as Books where Books.author_ID = author.ID
      )`)
  })
  it('handles FROM path with association with explicit table alias', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Books:author as author { author.name }`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as author { author.name }
        WHERE EXISTS ( SELECT 1 from bookshop.Books as Books where Books.author_ID = author.ID
      )`)
  })

  it('handles FROM path with association with mean explicit table alias', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Books:author as Books { name, Books.dateOfBirth }`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as Books { Books.name, Books.dateOfBirth}
        WHERE EXISTS ( SELECT 1 from bookshop.Books as Books2 where Books2.author_ID = Books.ID
      )`)
  })

  it('handles FROM path with backlink association', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Authors:books {books.ID}`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as books {books.ID} WHERE EXISTS (
        SELECT 1 from bookshop.Authors as Authors where Authors.ID = books.author_ID
      )`)
  })

  it('handles FROM path with unmanaged composition and prepends source side alias', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Books:texts { locale }`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Books.texts as texts {texts.locale} WHERE EXISTS (
        SELECT 1 from bookshop.Books as Books where texts.ID = Books.ID
      )`)
  })

  it('handles FROM path with struct and association', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Books:dedication.addressee { dateOfBirth }`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Person as addressee { addressee.dateOfBirth }
        WHERE EXISTS ( SELECT 1 from bookshop.Books as Books where Books.dedication_addressee_ID = addressee.ID
      )`)
  })

  it('handles FROM path with struct and association (2)', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.DeepRecursiveAssoc:one.two.three.toSelf { ID }`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.DeepRecursiveAssoc as toSelf { toSelf.ID }
        WHERE EXISTS (
          SELECT 1 from bookshop.DeepRecursiveAssoc as DeepRecursiveAssoc where DeepRecursiveAssoc.one_two_three_toSelf_ID = toSelf.ID
      )`)
  })
  it('handles FROM path with filter at entity plus association', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Books[ID=201]:author {author.ID}`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as author {author.ID} WHERE EXISTS (
        SELECT 1 from bookshop.Books as Books where Books.author_ID = author.ID and Books.ID=201
      )`)
  })

  // (SMW) here the explicit WHERE comes at the end (as it should be)
  it('handles FROM path with association and filters and WHERE', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Books[ID=201 or ID=202]:author[ID=4711 or ID=4712]{author.ID} where author.name='foo' or name='bar'`,
      model
    )
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Authors as author {author.ID}
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as Books where Books.author_ID = author.ID and (Books.ID=201 or Books.ID=202)
        ) and (author.ID=4711 or author.ID=4712) and (author.name='foo' or author.name='bar')`
    )
  })

  it('handles FROM path with association with one infix filter at leaf step', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Books:author[ID=4711] {author.ID}`, model)
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Authors as author {author.ID}
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as Books where Books.author_ID = author.ID
        ) and author.ID=4711`
    )
  })

  //
  // convenience:
  //   shortcut notation (providing only value) allowed in filter if association target has exactly one PK
  //

  // (SMW) TODO check
  // (PB) modified -> additional where condition e.g. infix filter in result are wrapped in `xpr`
  it('MUST ... in from clauses with infix filters, ODATA variant w/o mentioning key', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Books[201]:author[150] {ID}`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Authors as author {author.ID} WHERE EXISTS (
        SELECT 1 from bookshop.Books as Books where Books.author_ID = author.ID and Books.ID=201
      ) AND author.ID = 150`)
  })

  // (PB) new
  // (SMW) can this be deleted?
  it.skip('MUST not ... in from clauses with infix filters, ODATA variant w/o mentioning structured key', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.AssocWithStructuredKey:toStructuredKey[42]`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.WithStructuredKey as toStructuredKey {
        toStructuredKey.struct_mid_leaf,
        toStructuredKey.struct_mid_anotherLeaf,
        toStructuredKey.second
      } WHERE EXISTS (
        SELECT 1 from bookshop.AssocWithStructuredKey as AssocWithStructuredKey where
        AssocWithStructuredKey.toStructuredKey_struct_mid_leaf = toStructuredKey.struct_mid_leaf and
        AssocWithStructuredKey.toStructuredKey_struct_mid_anotherLeaf = toStructuredKey.struct_mid_anotherLeaf and
        AssocWithStructuredKey.toStructuredKey_second = toStructuredKey.second
      ) AND toStructuredKey.struct_mid_leaf = 42 and
      toStructuredKey.struct_mid_anotherLeaf = 42 and
      toStructuredKey.second = 42`)
  })

  // (SMW) TODO msg not good -> filter in general is ok for assoc with multiple FKS,
  // only shortcut notation is not allowed
  // TODO: message can include the fix: `write ”<key> = 42” explicitly`
  it('MUST ... reject filters on associations with multiple foreign keys', () => {
    expect(() => cqn4sql(CQL`SELECT from bookshop.AssocWithStructuredKey:toStructuredKey[42]`, model)).to.throw(
      /Filters can only be applied to managed associations which result in a single foreign key/
    )
  })

  // (SMW) TODO: check
  it('MUST ... in from clauses with infix filters ODATA variant w/o mentioning key ORDERS/ITEMS', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Orders[201]:items[2] {pos}`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Orders.items as items {items.pos} WHERE EXISTS (
        SELECT 1 from bookshop.Orders as Orders where Orders.ID = items.up__ID and Orders.ID = 201
      ) AND items.pos = 2`)
  })

  // (SMW) TODO: check
  // PB remark -> should `up__ID` be part of the where condition? Should this be an error?
  //              Usually filters on associations with multiple foreign keys are declined
  it.skip('MUST ... contain foreign keys of backlink association in on-condition?', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Orders:items[2] {pos}`, model)
    expect(query).to.throw()
  })

  it.skip('...', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Orders:items[pos=2] {pos}`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Orders.items as items {items.pos} WHERE EXISTS (
        SELECT 1 from bookshop.Orders as Orders where Orders.ID = items.up__ID
      ) and items.pos = 2`)
  })

  // TODO
  it.skip('MUST ... contain foreign keys of backlink association in on-condition? (3)', () => {
    expect(() => cqn4sql(CQL`SELECT from bookshop.Orders.items[2] {pos}`, model)).to.throw(
      /Please specify all primary keys in the infix filter/
    )
  })

  it('MUST ... be possible to address fully qualified, partial key in infix filter', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Orders.items[pos=2] {pos}`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Orders.items as items {items.pos} where items.pos = 2`)
  })

  it('handles paths with two associations', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Authors:books.genre {genre.ID}`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Genres as genre {genre.ID} WHERE EXISTS (
        SELECT 1 from bookshop.Books as books where books.genre_ID = genre.ID and EXISTS (
          SELECT 1 from bookshop.Authors as Authors where Authors.ID = books.author_ID
        )
      )`)
  })

  it('handles paths with two associations (mean alias)', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Authors:books.genre as books {books.ID}`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Genres as books {books.ID} WHERE EXISTS (
        SELECT 1 from bookshop.Books as books2 where books2.genre_ID = books.ID and EXISTS (
          SELECT 1 from bookshop.Authors as Authors where Authors.ID = books2.author_ID
        )
      )`)
  })

  it('handles paths with three associations', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Authors:books.genre.parent {parent.ID}`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Genres as parent {parent.ID} WHERE EXISTS (
        SELECT 1 from bookshop.Genres as genre where genre.parent_ID = parent.ID and EXISTS (
          SELECT 1 from bookshop.Books as books where books.genre_ID = genre.ID and EXISTS (
            SELECT 1 from bookshop.Authors as Authors where Authors.ID = books.author_ID
          )
        )
      )`)
  })

  it('handles paths with recursive associations', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Authors:books.genre.parent.parent.parent {parent.ID}`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Genres as parent {parent.ID}
      WHERE EXISTS (
        SELECT 1 from bookshop.Genres as parent2 where parent2.parent_ID = parent.ID and EXISTS (
          SELECT 1 from bookshop.Genres as parent3 where parent3.parent_ID = parent2.ID and EXISTS (
            SELECT 1 from bookshop.Genres as genre where genre.parent_ID = parent3.ID and EXISTS (
              SELECT 1 from bookshop.Books as books where books.genre_ID = genre.ID and EXISTS (
                SELECT 1 from bookshop.Authors as Authors where Authors.ID = books.author_ID
              )
            )
          )
        )
      )`)
  })

  it('handles paths with unmanaged association', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Baz:parent {id}`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Baz as parent {parent.id} WHERE EXISTS (
        SELECT 1 from bookshop.Baz as Baz where parent.id = Baz.parent_id or parent.id > 17
      )`)
  })

  it('handles paths with unmanaged association with alias', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Baz:parent as A {id}`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Baz as A {A.id} WHERE EXISTS (
        SELECT 1 from bookshop.Baz as Baz where A.id = Baz.parent_id or A.id > 17
      )`)
  })

  // (SMW) need more tests with unmanaged ON conds using all sorts of stuff -> e.g. struc access in ON, FK of mgd assoc in FROM ...

  it('transforms unmanaged association to where exists subquery and infix filter', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Baz:parent[id<20] {parent.id}`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Baz as parent {parent.id} WHERE EXISTS (
        SELECT 1 from bookshop.Baz as Baz where parent.id = Baz.parent_id or parent.id > 17
      ) AND parent.id < 20`)
  })
  it('transforms unmanaged association to where exists subquery with multiple infix filter', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Baz:parent[id<20 or id > 12] {parent.id}`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Baz as parent {parent.id} WHERE EXISTS (
        SELECT 1 from bookshop.Baz as Baz where parent.id = Baz.parent_id or parent.id > 17
      ) AND (parent.id < 20 or parent.id > 12)`)
  })

  //
  // assocs with complicated ON
  //

  it('exists predicate in infix filter in FROM', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Authors[exists books] {ID}`,
      model
    )
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Authors as Authors {Authors.ID}
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as books where books.author_ID = Authors.ID
        )`
    )
  })

  it('exists predicate in infix filter at ssoc path step in FROM', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Books:author[exists books] {ID}`,
      model
    )
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Authors as author {author.ID}
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as Books where Books.author_ID = author.ID
        ) and EXISTS (
          SELECT 1 from bookshop.Books as books2 where books2.author_ID = author.ID
        )`
    )
  })

  it('exists predicate followed by unmanaged assoc as infix filter (also within xpr)', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Books:author[exists books[exists coAuthorUnmanaged or title = 'Sturmhöhe']] { ID }`,
      model
    )
    expect(query)
      .to.deep.equal(
        CQL`SELECT from bookshop.Authors as author {author.ID}
            where exists (
              SELECT 1 from bookshop.Books as Books where Books.author_ID = author.ID
            ) and exists (
              SELECT 1 from bookshop.Books as books2 where books2.author_ID = author.ID
              and 
              ( 
                exists (
                SELECT 1 from bookshop.Authors as coAuthorUnmanaged where coAuthorUnmanaged.ID = books2.coAuthor_ID_unmanaged
                )  or books2.title = 'Sturmhöhe'
              )
            )
      `)
  })

  it('exists predicate in infix filter followed by assoc in FROM', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Books[exists genre]:author {ID}`,
      model
    )
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Authors as author {author.ID}
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as Books where Books.author_ID = author.ID
            and EXISTS (
              SELECT 1 from bookshop.Genres as genre where genre.ID = Books.genre_ID
            )
        )`
    )
  })

  it('exists predicate in infix filters in FROM', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Books[exists genre]:author[exists books] {ID}`,
      model
    )
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Authors as author {author.ID}
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as Books where Books.author_ID = author.ID
          and EXISTS (
            SELECT 1 from bookshop.Genres as genre where genre.ID = Books.genre_ID
          )
        ) and EXISTS (
          SELECT 1 from bookshop.Books as books2 where books2.author_ID = author.ID
        )`
    )
  })

  // (SMW) revisit: semantically correct, but order of infix filter and exists subqueries not consistent
  it('exists predicate in infix filters in FROM, multiple assoc steps', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Books[exists genre]:author[exists books].books[exists genre] {ID}`,
      model
    )
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Books as books {books.ID}
        WHERE EXISTS (
          SELECT 1 from bookshop.Authors as author where author.ID = books.author_ID
            and EXISTS (
              SELECT 1 from bookshop.Books as books2 where books2.author_ID = author.ID
            )
            and EXISTS (
              SELECT 1 from bookshop.Books as Books3 where Books3.author_ID = author.ID
                and EXISTS (
                  SELECT 1 from bookshop.Genres as genre where genre.ID = Books3.genre_ID
                )
          )
        ) and EXISTS (
          SELECT 1 from bookshop.Genres as genre2 where genre2.ID = books.genre_ID
        )`
    )
  })

  it('... managed association with structured FK', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.AssocMaze1:a_struc { val }`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.AssocMaze2 as a_struc { a_struc.val } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze1 as AssocMaze1 where AssocMaze1.a_struc_ID_1_a = a_struc.ID_1_a and AssocMaze1.a_struc_ID_1_b = a_struc.ID_1_b
                                                          and AssocMaze1.a_struc_ID_2_a = a_struc.ID_2_a and AssocMaze1.a_struc_ID_2_b =  a_struc.ID_2_b
      )`)
  })

  it('... managed association with explicit simple FKs', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.AssocMaze1:a_strucX { val }`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.AssocMaze2 as a_strucX { a_strucX.val } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze1 as AssocMaze1 where AssocMaze1.a_strucX_a = a_strucX.a and AssocMaze1.a_strucX_b = a_strucX.b
      )`)
  })

  it('... managed association with explicit structured FKs', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.AssocMaze1:a_strucY { val }`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.AssocMaze2 as a_strucY { a_strucY.val } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze1 as AssocMaze1 where AssocMaze1.a_strucY_S_1_a = a_strucY.S_1_a and AssocMaze1.a_strucY_S_1_b = a_strucY.S_1_b
                                                          and AssocMaze1.a_strucY_S_2_a = a_strucY.S_2_a and AssocMaze1.a_strucY_S_2_b = a_strucY.S_2_b
      )`)
  })

  it('... managed association with explicit structured aliased FKs', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.AssocMaze1:a_strucXA { val }`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.AssocMaze2 as a_strucXA { a_strucXA.val } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze1 as AssocMaze1 where AssocMaze1.a_strucXA_T_1_a = a_strucXA.S_1_a and AssocMaze1.a_strucXA_T_1_b = a_strucXA.S_1_b
                                                          and AssocMaze1.a_strucXA_T_2_a = a_strucXA.S_2_a and AssocMaze1.a_strucXA_T_2_b = a_strucXA.S_2_b
      )`)
  })

  it('... managed associations with FKs being managed associations', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.AssocMaze1:a_assoc { val }`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.AssocMaze3 as a_assoc { a_assoc.val } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze1 as AssocMaze1 where AssocMaze1.a_assoc_assoc1_ID_1_a = a_assoc.assoc1_ID_1_a and AssocMaze1.a_assoc_assoc1_ID_1_b = a_assoc.assoc1_ID_1_b
                                                          and AssocMaze1.a_assoc_assoc1_ID_2_a = a_assoc.assoc1_ID_2_a and AssocMaze1.a_assoc_assoc1_ID_2_b = a_assoc.assoc1_ID_2_b
                                                          and AssocMaze1.a_assoc_assoc2_ID_1_a = a_assoc.assoc2_ID_1_a and AssocMaze1.a_assoc_assoc2_ID_1_b = a_assoc.assoc2_ID_1_b
                                                          and AssocMaze1.a_assoc_assoc2_ID_2_a = a_assoc.assoc2_ID_2_a and AssocMaze1.a_assoc_assoc2_ID_2_b = a_assoc.assoc2_ID_2_b
      )`)
  })

  it('... managed association with explicit FKs being managed associations', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.AssocMaze1:a_assocY { val }`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.AssocMaze2 as a_assocY { a_assocY.val } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze1 as AssocMaze1 where AssocMaze1.a_assocY_A_1_a = a_assocY.A_1_a and AssocMaze1.a_assocY_A_1_b_ID = a_assocY.A_1_b_ID
                                                          and AssocMaze1.a_assocY_A_2_a = a_assocY.A_2_a and AssocMaze1.a_assocY_A_2_b_ID = a_assocY.A_2_b_ID
      )`)
  })

  it('... managed association with explicit aliased FKs being managed associations', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.AssocMaze1:a_assocYA { val }`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.AssocMaze2 as a_assocYA { a_assocYA.val } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze1 as AssocMaze1 where AssocMaze1.a_assocYA_B_1_a = a_assocYA.A_1_a and AssocMaze1.a_assocYA_B_1_b_ID = a_assocYA.A_1_b_ID
                                                          and AssocMaze1.a_assocYA_B_2_a = a_assocYA.A_2_a and AssocMaze1.a_assocYA_B_2_b_ID = a_assocYA.A_2_b_ID
      )`)
  })

  it('... managed associations with FKs being mix of struc and managed assoc', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.AssocMaze1:a_strass { val }`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.AssocMaze4 as a_strass { a_strass.val } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze1 as AssocMaze1
          where AssocMaze1.a_strass_A_1_a = a_strass.A_1_a
            and AssocMaze1.a_strass_A_1_b_assoc1_ID_1_a = a_strass.A_1_b_assoc1_ID_1_a and AssocMaze1.a_strass_A_1_b_assoc1_ID_1_b = a_strass.A_1_b_assoc1_ID_1_b
            and AssocMaze1.a_strass_A_1_b_assoc1_ID_2_a = a_strass.A_1_b_assoc1_ID_2_a and AssocMaze1.a_strass_A_1_b_assoc1_ID_2_b = a_strass.A_1_b_assoc1_ID_2_b
            and AssocMaze1.a_strass_A_1_b_assoc2_ID_1_a = a_strass.A_1_b_assoc2_ID_1_a and AssocMaze1.a_strass_A_1_b_assoc2_ID_1_b = a_strass.A_1_b_assoc2_ID_1_b
            and AssocMaze1.a_strass_A_1_b_assoc2_ID_2_a = a_strass.A_1_b_assoc2_ID_2_a and AssocMaze1.a_strass_A_1_b_assoc2_ID_2_b = a_strass.A_1_b_assoc2_ID_2_b
            and AssocMaze1.a_strass_A_2_a = a_strass.A_2_a
            and AssocMaze1.a_strass_A_2_b_assoc1_ID_1_a = a_strass.A_2_b_assoc1_ID_1_a and AssocMaze1.a_strass_A_2_b_assoc1_ID_1_b = a_strass.A_2_b_assoc1_ID_1_b
            and AssocMaze1.a_strass_A_2_b_assoc1_ID_2_a = a_strass.A_2_b_assoc1_ID_2_a and AssocMaze1.a_strass_A_2_b_assoc1_ID_2_b = a_strass.A_2_b_assoc1_ID_2_b
            and AssocMaze1.a_strass_A_2_b_assoc2_ID_1_a = a_strass.A_2_b_assoc2_ID_1_a and AssocMaze1.a_strass_A_2_b_assoc2_ID_1_b = a_strass.A_2_b_assoc2_ID_1_b
            and AssocMaze1.a_strass_A_2_b_assoc2_ID_2_a = a_strass.A_2_b_assoc2_ID_2_a and AssocMaze1.a_strass_A_2_b_assoc2_ID_2_b = a_strass.A_2_b_assoc2_ID_2_b
      )`)
  })

  it('on condition of to many composition in csn model has xpr', () => {
    const q = CQL`
      SELECT from bookshop.WorklistItems[ID = 1 and snapshotHash = 0]:releaseChecks[ID = 1 and snapshotHash = 0].detailsDeviations
    `
    const expected = CQL`
      SELECT from bookshop.QualityDeviations as detailsDeviations {
        detailsDeviations.snapshotHash,
        detailsDeviations.ID,
        detailsDeviations.batch_ID,
        detailsDeviations.material_ID,
      } where exists (
        SELECT 1 from bookshop.WorklistItem_ReleaseChecks as releaseChecks
        where detailsDeviations.material_ID = releaseChecks.parent_releaseDecisionTrigger_batch_material_ID
              and ( detailsDeviations.batch_ID = '*' or detailsDeviations.batch_ID = releaseChecks.parent_releaseDecisionTrigger_batch_ID )
              and detailsDeviations.snapshotHash = releaseChecks.snapshotHash
              and releaseChecks.ID = 1 and releaseChecks.snapshotHash = 0
              and exists (
                SELECT 1 from bookshop.WorklistItems as WorklistItems
                where releaseChecks.parent_ID = WorklistItems.ID
                  and releaseChecks.parent_snapshotHash = WorklistItems.snapshotHash
                  and WorklistItems.ID = 1 and WorklistItems.snapshotHash = 0
              )
      )
    `
    expect(cqn4sql(q)).to.deep.equal(expected)
  })
  it('on condition of to many composition in csn model has xpr and dangling filter', () => {
    const q = CQL`
      SELECT from bookshop.WorklistItems[ID = 1 and snapshotHash = 0]
      :releaseChecks[ID = 1 and snapshotHash = 0]
      .detailsDeviations[ID='0' and snapshotHash='0'and batch_ID='*' and material_ID='1']
    `
    const expected = CQL`
      SELECT from bookshop.QualityDeviations as detailsDeviations {
        detailsDeviations.snapshotHash,
        detailsDeviations.ID,
        detailsDeviations.batch_ID,
        detailsDeviations.material_ID,
      } where exists (
        SELECT 1 from bookshop.WorklistItem_ReleaseChecks as releaseChecks
        where detailsDeviations.material_ID = releaseChecks.parent_releaseDecisionTrigger_batch_material_ID
              and ( detailsDeviations.batch_ID = '*' or detailsDeviations.batch_ID = releaseChecks.parent_releaseDecisionTrigger_batch_ID )
              and detailsDeviations.snapshotHash = releaseChecks.snapshotHash
              and releaseChecks.ID = 1 and releaseChecks.snapshotHash = 0
              and exists (
                SELECT 1 from bookshop.WorklistItems as WorklistItems
                where releaseChecks.parent_ID = WorklistItems.ID
                  and releaseChecks.parent_snapshotHash = WorklistItems.snapshotHash
                  and WorklistItems.ID = 1 and WorklistItems.snapshotHash = 0
              )
      )
      and (
              detailsDeviations.ID = '0'
          and detailsDeviations.snapshotHash = '0'
          and detailsDeviations.batch_ID = '*'
          and detailsDeviations.material_ID = '1'
        )
    `
    expect(cqn4sql(q)).to.deep.equal(expected)
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
    model = cds.model = await cds.load(__dirname + '/bookshop/srv/cat-service').then(cds.linked)
  })
  //
  // mixing path in FROM and WHERE EXISTS
  // SMW -> move that in a seperate "describe" ?
  //
  it('MUST ... mixed with path in FROM clause', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Books:genre { ID } where exists parent`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Genres as genre { genre.ID }
        WHERE EXISTS ( SELECT 1 from bookshop.Books as Books where Books.genre_ID = genre.ID )
          AND EXISTS ( SELECT 1 from bookshop.Genres as parent where parent.ID = genre.parent_ID )
      `)
  })

  // semantically same as above
  it('MUST ... EXISTS in filter in FROM', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Books:genre[exists parent] { ID }`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Genres as genre { genre.ID }
        WHERE EXISTS ( SELECT 1 from bookshop.Books as Books where Books.genre_ID = genre.ID )
          AND EXISTS ( SELECT 1 from bookshop.Genres as parent where parent.ID = genre.parent_ID )
      `)
  })
})

describe('comparisons of associations in on condition of elements needs to be expanded', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/A2J/schema').then(cds.linked)
  })

  it('OData lambda where exists comparing managed assocs', () => {
    const query = cqn4sql(CQL`SELECT from a2j.Foo { ID } where exists buz`, model)
    const expected = CQL`
      SELECT from a2j.Foo as Foo {
        Foo.ID
      } where exists (
        SELECT 1 FROM a2j.Buz as buz
          where (buz.bar_ID = Foo.bar_ID AND buz.bar_foo_ID = Foo.bar_foo_ID) and buz.foo_ID = Foo.ID
      )
    `
    expect(query).to.eql(expected)
  })
  it('OData lambda where exists comparing managed assocs with renamed keys', () => {
    const query = cqn4sql(CQL`SELECT from a2j.Foo { ID } where exists buzRenamed`, model)
    const expected = CQL`
      SELECT from a2j.Foo as Foo {
        Foo.ID
      } where exists (
        SELECT 1 FROM a2j.Buz as buzRenamed
          where (buzRenamed.barRenamed_renameID = Foo.barRenamed_renameID AND buzRenamed.barRenamed_foo_ID = Foo.barRenamed_foo_ID) and buzRenamed.foo_ID = Foo.ID
      )
    `
    expect(query).to.eql(expected)
  })
  it('OData lambda where exists with unmanaged assoc', () => {
    const query = cqn4sql(CQL`SELECT from a2j.Foo { ID } where exists buzUnmanaged`, model)
    const expected = CQL`
      SELECT from a2j.Foo as Foo {
        Foo.ID
      } where exists (
        SELECT 1 FROM a2j.Buz as buzUnmanaged
          where buzUnmanaged.bar_foo_ID = Foo.bar_foo_ID AND buzUnmanaged.bar_ID = Foo.bar_ID and buzUnmanaged.foo_ID = Foo.ID
      )
    `
    expect(query).to.eql(expected)
  })
})

