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
    it('exists predicate for to-many assoc w/o alias', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Books { ID } where exists author`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as $B { $B.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Authors as $a where $a.ID = $B.author_ID
        )`)
    })
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
    it('MUST ... two EXISTS both on same path in where', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books { ID } where exists genre.children[code = 'ABC'] or exists genre.children[code = 'DEF']`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as $B { $B.ID }
      WHERE EXISTS (
        SELECT 1 from bookshop.Genres as $g where $g.ID = $B.genre_ID
          and EXISTS ( SELECT 1 from bookshop.Genres as $c where $c.parent_ID = $g.ID and $c.code = 'ABC' )
      )
      or  EXISTS (
        SELECT 1 from bookshop.Genres as $g2 where $g2.ID = $B.genre_ID
        and EXISTS ( SELECT 1 from bookshop.Genres as $c2 where $c2.parent_ID = $g2.ID and $c2.code = 'DEF' )
      )`)
    })
    it('exists predicate for assoc combined with path expression in xpr', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books { ID } where exists author and ((author.name + 's') = 'Schillers')`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`
      SELECT from bookshop.Books as $B
        left join bookshop.Authors as author on author.ID = $B.author_ID
        {
          $B.ID
        }
      WHERE EXISTS (
        SELECT 1 from bookshop.Authors as $a where $a.ID = $B.author_ID
        ) and ((author.name + 's') = 'Schillers')`)
    })

    it('handles simple where exists with implicit table alias', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID } where exists Books.author`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books { Books.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Authors as $a where $a.ID = Books.author_ID
        )`)
    })

    it('handles simple where exists with explicit table alias', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Authors as Authors { ID } WHERE EXISTS Authors.books`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b where $b.author_ID = Authors.ID
        )`)
    })
    //
    // lonely association in EXISTS + variations with table alias
    // "give me all authors who have a book"
    //
    it('exists predicate for to-many assoc', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Authors { ID } WHERE EXISTS books`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as $A { $A.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b where $b.author_ID = $A.ID
        )`)
    })

    it('FROM clause has explicit table alias', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Authors as A { ID } WHERE EXISTS books`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as A { A.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b where $b.author_ID = A.ID
        )`)
    })

    it('using explicit table alias of FROM clause', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Authors as A { ID } WHERE EXISTS A.books`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as A { A.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b where $b.author_ID = A.ID
        )`)
    })

    it('FROM clause has table alias with the same name as the assoc', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Authors as books { ID } WHERE EXISTS books`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as books { books.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b where $b.author_ID = books.ID
        )`)
    })

    it('using the mean table alias of the FROM clause to access the association', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Authors as books { ID } WHERE EXISTS books.books`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as books { books.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b where $b.author_ID = books.ID
        )`)
    })

    it('exists predicate has additional condition', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Authors { ID } WHERE exists books and name = 'Horst'`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as $A { $A.ID }
          WHERE exists ( select 1 from bookshop.Books as $b where $b.author_ID = $A.ID )
           AND $A.name = 'Horst'
        `)
    })
    it('exists predicate is followed by association-like calculated element', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Authors { ID } WHERE exists booksWithALotInStock and name = 'Horst'`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as $A { $A.ID }
          WHERE exists ( select 1 from bookshop.Books as $b where ( $b.author_ID = $A.ID ) and ( $b.stock > 100 ) )
           AND $A.name = 'Horst'
        `)
    })
  })
  describe('wrapped in expression', () => {
    it('exists predicate in xpr combined with infix filter', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books { ID } where ( ( exists author[name = 'Schiller'] ) + 2 ) = 'foo'`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as $B { $B.ID }
        WHERE (
          (
            EXISTS ( SELECT 1 from bookshop.Authors as $a where $a.ID = $B.author_ID and $a.name = 'Schiller' )
          ) + 2
        ) = 'foo'`)
    })
    it('nested exists wrapped in infix filter', () => {
      let query = cds.ql`SELECT from bookshop.Authors { ID } where exists books[ exists genre[ parent = 1 ] ]`
      // some OData requests lead to a nested `xpr: [ exists <assoc> ]` which
      // cannot be expressed with the template string cds.ql`` builder
      query.SELECT.where[1].ref[0].where = [{ xpr: [...query.SELECT.where[1].ref[0].where] }]
      const res = cqn4sql(query, model)
      const expected = cds.ql`
      SELECT from bookshop.Authors as $A { $A.ID } where exists (
        SELECT 1 from bookshop.Books as $b where $b.author_ID = $A.ID
          and exists (
            SELECT 1 from bookshop.Genres as $g where $g.ID = $b.genre_ID and $g.parent_ID = 1
          )
      )`
      // cannot be expressed with the template string cds.ql`` builder
      expected.SELECT.where[1].SELECT.where.splice(4, Infinity, {
        xpr: [...expected.SELECT.where[1].SELECT.where.slice(4)],
      })
      expect(res).to.deep.eql(expected)
    })
  })

  describe('infix filter', () => {
    it('where exists to-one association with additional filter', () => {
      // note: now all source side elements are addressed with their table alias
      let query = cqn4sql(cds.ql`SELECT from bookshop.Books { ID } where exists author[name = 'Sanderson']`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as $B { $B.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Authors as $a where $a.ID = $B.author_ID and $a.name = 'Sanderson'
        )`)
    })
    it('additional condition needs to be wrapped in brackets', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Authors { ID } where exists books[contains(title, 'Gravity') or contains(title, 'Dark')]`,
        model,
      )
      const expected = cds.ql`SELECT from bookshop.Authors as $A { $A.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b where $b.author_ID = $A.ID and ( contains($b.title, 'Gravity') or contains($b.title, 'Dark') )
        )`
      expect(query).to.deep.equal(expected)
    })
    it('additional condition needs to be wrapped in brackets (scoped)', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Authors:books[contains(title, 'Gravity') or contains(title, 'Dark')] { ID }`,
        model,
      )
      let otherWayOfWritingFilter = cqn4sql(
        cds.ql`SELECT from bookshop.Authors:books { ID } where contains(title, 'Gravity') or contains(title, 'Dark')`,
        model,
      )
      const expected = cds.ql`
      SELECT from bookshop.Books as $b { $b.ID }
        where exists (
          SELECT 1 from bookshop.Authors as $A where $A.ID = $b.author_ID
        ) and (
           contains($b.title, 'Gravity') or contains($b.title, 'Dark')
        )
      `
      expect(query).to.deep.equal(otherWayOfWritingFilter).to.deep.equal(expected)
    })
    it('where exists to-one association with additional filter with xpr', () => {
      // note: now all source side elements are addressed with their table alias
      let query = cqn4sql(cds.ql`SELECT from bookshop.Books { ID } where exists author[not (name = 'Sanderson')]`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as $B { $B.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Authors as $a where $a.ID = $B.author_ID and not ($a.name = 'Sanderson')
        )`)
    })

    it('MUST ... with simple filter', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Authors { ID } WHERE EXISTS books[title = 'ABAP Objects']`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as $A { $A.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b where $b.author_ID = $A.ID AND $b.title = 'ABAP Objects'
        )`)
    })

    it('MUST fail for unknown field in filter (1)', () => {
      expect(() =>
        cqn4sql(cds.ql`SELECT from bookshop.Authors { ID } WHERE EXISTS books[books.title = 'ABAP Objects']`, model),
      ).to.throw(/"books" not found in "books"/)
      // it would work if entity "Books" had a field called "books"
      // Done by infer
    })

    it('MUST fail for unknown field in filter (2)', () => {
      expect(() =>
        cqn4sql(cds.ql`SELECT from bookshop.Authors { ID } WHERE EXISTS books[Authors.name = 'Horst']`, model),
      ).to.throw(/"Authors" not found in "books"/)
      //expect (query) .to.fail
    })

    it('MUST ... access struc fields in filter', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Authors { ID } WHERE EXISTS books[dedication.text = 'For Hasso']`,
        model,
      )
      // TODO original test had no before `dedication_text`
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as $A { $A.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b where $b.author_ID = $A.ID AND $b.dedication_text = 'For Hasso'
        )`)
    })

    // accessing FK of managed assoc in filter
    it('MUST ... access FK of managed assoc in filter', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Authors { ID } WHERE EXISTS books[dedication.addressee.ID = 29]`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as $A { $A.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b where $b.author_ID = $A.ID AND $b.dedication_addressee_ID = 29
        )`)
    })

    it('MUST not fail if following managed assoc in filter in where exists', () => {
      expect(() =>
        cqn4sql(
          cds.ql`SELECT from bookshop.Authors { ID } WHERE EXISTS books[dedication.addressee.name = 'Hasso']`,
          model,
        ),
      ).to.not.throw('Only foreign keys of “addressee” can be accessed in infix filter')
    })
    it('MUST fail if following managed assoc in filter (path expressions inside filter only enabled for exists subqueries)', () => {
      expect(() =>
        cqn4sql(
          cds.ql`SELECT from bookshop.Authors { ID, books[dedication.addressee.name = 'Hasso'].dedication.addressee.name as Hasso }`,
          model,
        ),
      ).to.throw('Only foreign keys of “addressee” can be accessed in infix filter')
    })

    it('MUST handle simple where exists with multiple association and also with $self backlink', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books { ID } where exists author.books[title = 'Harry Potter']`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as $B { $B.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Authors as $a where $a.ID = $B.author_ID and EXISTS (
            SELECT 1 from bookshop.Books as $b2 where $b2.author_ID = $a.ID and $b2.title = 'Harry Potter'
          )
        )`)
    })

    it('MUST handle simple where exists with additional filter, shortcut notation', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Books { ID } where exists author[17]`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as $B { $B.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Authors as $a where $a.ID = $B.author_ID and $a.ID = 17
        )`)
    })
  })

  describe('nested exists in infix filter', () => {
    it('MUST handle simple where exists with multiple association and also with $self backlink in shortcut notation', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books { ID } where exists author[exists books[title = 'Harry Potter']]`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as $B { $B.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Authors as $a where $a.ID = $B.author_ID and EXISTS (
            SELECT 1 from bookshop.Books as $b2 where $b2.author_ID = $a.ID and $b2.title = 'Harry Potter'
            )
          )`)
    })

    // --> paths for exists predicates?

    // let { query2 } = cqn4sql (cds.ql`SELECT from bookshop.Books { ID } where exists author[exists books.title = 'Harry Potter']`, model)
    // let { query3 } = cqn4sql (cds.ql`SELECT from bookshop.Books { ID } where exists author[books.title = 'Harry Potter']`, model)
    // let { query4 } = cqn4sql (cds.ql`SELECT from bookshop.Books { ID } where exists author.books[title = 'Harry Potter']`, model)
    // let { query5 } = cqn4sql (cds.ql`SELECT from bookshop.Books { ID } where exists author.books.title = 'Harry Potter'`, model)

    it('MUST ... nested EXISTS with additional condition', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Authors { ID } WHERE EXISTS books[EXISTS author or title = 'Gravity']`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as $A { $A.ID } WHERE
      EXISTS
        (
          SELECT 1 from bookshop.Books as $b where $b.author_ID = $A.ID AND
          (
            EXISTS
              (
                SELECT 1 from bookshop.Authors as $a2 where $a2.ID = $b.author_ID
              ) or $b.title = 'Gravity'
          )
        )`)
    })
    it('nested EXISTS with unmanaged assoc', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Authors { ID } WHERE EXISTS books[EXISTS coAuthorUnmanaged[EXISTS books]]`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as $A { $A.ID } WHERE
      EXISTS
        (
          SELECT 1 from bookshop.Books as $b where $b.author_ID = $A.ID AND
            EXISTS
              (
                SELECT 1 from bookshop.Authors as $c
                  where $c.ID = $b.coAuthor_ID_unmanaged AND
                   EXISTS
                   (
                    SELECT 1 from bookshop.Books as $b2 where
                      $b2.author_ID = $c.ID
                   )
              )
        )`)
    })
    it('MUST ... EXISTS with nested assoc', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Books { ID } WHERE EXISTS dedication.addressee`, model)
      expect(query).to.deep.equal(
        cds.ql`SELECT from bookshop.Books as $B { $B.ID }
              WHERE EXISTS (
                SELECT 1 from bookshop.Person as $a where $a.ID = $B.dedication_addressee_ID
              )`,
      )
    })

    it('MUST ... nested EXISTS with additional condition reversed', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Authors { ID } WHERE EXISTS books[title = 'Gravity' or EXISTS author]`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as $A { $A.ID } WHERE EXISTS (
            SELECT 1 from bookshop.Books as $b where
            $b.author_ID = $A.ID AND
            ( $b.title = 'Gravity' or
              EXISTS
                (
                  SELECT 1 from bookshop.Authors as $a2 where $a2.ID = $b.author_ID
                )
            )
          )`)
    })

    it('MUST ... 3 nested EXISTS', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Authors { ID } WHERE EXISTS books[NOT EXISTS author[EXISTS books]]`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as $A { $A.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b where $b.author_ID = $A.ID AND NOT EXISTS (
            SELECT 1 from bookshop.Authors as $a2 where $a2.ID = $b.author_ID AND EXISTS (
              SELECT 1 from bookshop.Books as $b2 where $b2.author_ID = $a2.ID
            )
          )
        )`)
    })

    //
    // nested EXISTS and more than one assoc
    //
    it('MUST ... 2 assocs with nested EXISTS (1)', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Authors { ID } WHERE EXISTS books[EXISTS author or title = 'Gravity'].genre[name = 'Fiction']`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as $A { $A.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b where $b.author_ID = $A.ID AND ( EXISTS (
            SELECT 1 from bookshop.Authors as $a2 where $a2.ID = $b.author_ID
          ) or $b.title = 'Gravity' ) AND  EXISTS (
            SELECT 1 from bookshop.Genres as $g where $g.ID = $b.genre_ID and $g.name = 'Fiction'
          )
        )`)
    })

    // pretty weird ...
    // `EXISTS author or title = 'Gravity'` -> filter condition is wrapped in xpr because of `OR`
    //  compare to the second exits subquery which does not need to be wrapped in xpr
    it('MUST ... 2 assocs with nested EXISTS (2)', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Authors { ID } WHERE EXISTS books[EXISTS author or title = 'Gravity'].genre[name = 'Fiction' and exists children[name = 'Foo']]`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as $A { $A.ID } WHERE EXISTS (
          SELECT 1 from bookshop.Books as $b where $b.author_ID = $A.ID AND ( EXISTS (
            SELECT 1 from bookshop.Authors as $a2 where $a2.ID = $b.author_ID
          ) or $b.title = 'Gravity') AND EXISTS (
            SELECT 1 from bookshop.Genres as $g where $g.ID = $b.genre_ID AND $g.name = 'Fiction' AND EXISTS (
              SELECT 1 from bookshop.Genres as $c where $c.parent_ID = $g.ID AND $c.name = 'Foo'
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
      let query = cqn4sql(cds.ql`SELECT from bookshop.Authors { ID } WHERE EXISTS books.author`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as $A { $A.ID } WHERE EXISTS (
        SELECT 1 from bookshop.Books as $b where $b.author_ID = $A.ID AND EXISTS (
          SELECT 1 from bookshop.Authors as $a2 where $a2.ID = $b.author_ID
        )
      )`)
    })

    it('MUST ... with 4 assocs', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Authors { ID } WHERE EXISTS books.author.books.author`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as $A { $A.ID } WHERE EXISTS (
        SELECT 1 from bookshop.Books as $b where $b.author_ID = $A.ID AND EXISTS (
          SELECT 1 from bookshop.Authors as $a2 where $a2.ID = $b.author_ID AND EXISTS (
            SELECT 1 from bookshop.Books as $b2 where $b2.author_ID = $a2.ID AND EXISTS (
              SELECT 1 from bookshop.Authors as $a3 where $a3.ID = $b2.author_ID
            )
          )
        )
      )`)
    })

    it('MUST ... adjacent EXISTS with 4 assocs each', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Authors { ID } WHERE EXISTS books.author.books.author AND EXISTS books.author.books.author`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as $A { $A.ID } WHERE EXISTS (
        SELECT 1 from bookshop.Books as $b where $b.author_ID = $A.ID AND EXISTS (
          SELECT 1 from bookshop.Authors as $a2 where $a2.ID = $b.author_ID AND EXISTS (
            SELECT 1 from bookshop.Books as $b2 where $b2.author_ID = $a2.ID AND EXISTS (
              SELECT 1 from bookshop.Authors as $a3 where $a3.ID = $b2.author_ID
            )
          )
        )
      ) AND EXISTS (
        SELECT 1 from bookshop.Books as $b3 where $b3.author_ID = $A.ID AND EXISTS (
          SELECT 1 from bookshop.Authors as $a4 where $a4.ID = $b3.author_ID AND EXISTS (
            SELECT 1 from bookshop.Books as $b4 where $b4.author_ID = $a4.ID AND EXISTS (
              SELECT 1 from bookshop.Authors as $a5 where $a5.ID = $b4.author_ID
            )
          )
        )
      )`)
    })
    it.skip('COULD use the same table aliases in independent EXISTS subqueries', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Authors { ID } WHERE EXISTS books.author.books.author AND EXISTS books.author.books.author`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE EXISTS (
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
        cds.ql`SELECT from bookshop.Authors { ID } WHERE EXISTS books[stock > 11].author[name = 'Horst'].books[price < 9.99].author[placeOfBirth = 'Rom']`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as $A { $A.ID } WHERE EXISTS (
        SELECT 1 from bookshop.Books as $b where $b.author_ID = $A.ID AND $b.stock > 11 AND EXISTS (
          SELECT 1 from bookshop.Authors as $a2 where $a2.ID = $b.author_ID AND $a2.name = 'Horst' AND EXISTS (
            SELECT 1 from bookshop.Books as $b2 where $b2.author_ID = $a2.ID AND $b2.price < 9.99 AND EXISTS (
              SELECT 1 from bookshop.Authors as $a3 where $a3.ID = $b2.author_ID AND $a3.placeOfBirth = 'Rom'
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
        cds.ql`SELECT from bookshop.Books {
        ID,
        case when exists author then 'yes'
             else 'no'
        end as x
       }`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as $B {
        $B.ID,
        case when exists (SELECT 1 from bookshop.Authors as $a where $a.ID = $B.author_ID) then 'yes'
             else 'no'
        end as x
      }`)
    })

    it('MUST handle negated where exists wrapped in xpr in CASE', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books {
        ID,
        case when not (exists author[name = 'FOO'] or exists author[name = 'BAR']) then 'yes'
             else 'no'
        end as x
       }`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as $B {
        $B.ID,
        case when not (
          exists (SELECT 1 from bookshop.Authors as $a where $a.ID = $B.author_ID and $a.name = 'FOO')
          or
          exists (SELECT 1 from bookshop.Authors as $a2 where $a2.ID = $B.author_ID and $a2.name = 'BAR')
        ) then 'yes'
             else 'no'
        end as x
      }`)
    })

    it('MUST handle simple where exists with filter in CASE', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books {
        ID,
        case when exists author[name = 'Sanderson'] then 'yes'
             else 'no'
        end as x
       }`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as $B {
        $B.ID,
        case when exists
          (
            SELECT 1 from bookshop.Authors as $a where $a.ID = $B.author_ID and $a.name = 'Sanderson'
          ) then 'yes'
             else 'no'
        end as x
      }`)
    })

    it('exists in case with two branches', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Authors
       { ID,
         case when exists books[price>10]  then 1
              when exists books[price>100] then 2
         end as descr
       }`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as $A
        { $A.ID,
          case when exists
          (
            select 1 from bookshop.Books as $b where $b.author_ID = $A.ID and $b.price > 10
          )
          then 1
               when exists
               (
                  select 1 from bookshop.Books as $b2 where $b2.author_ID = $A.ID and $b2.price > 100
               )
               then 2
          end as descr
        }
      `)
    })
    it('exists in case with two branches both are association-like calculated element', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Authors
       { ID,
         case when exists booksWithALotInStock[price > 10 or price < 20]  then 1
              when exists booksWithALotInStock[price > 100 or price < 120] then 2
         end as descr
       }`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Authors as $A
        { $A.ID,
          case 
          when exists
          (
            select 1 from bookshop.Books as $b where ( $b.author_ID = $A.ID ) and ( $b.stock > 100 ) and ( $b.price > 10 or $b.price < 20 )
          ) then 1
          when exists
          (
            select 1 from bookshop.Books as $b2 where ( $b2.author_ID = $A.ID ) and ( $b2.stock > 100 ) and ( $b2.price > 100 or $b2.price < 120 )
          ) then 2
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
      let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID } WHERE EXISTS a_struc`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.AssocMaze1 as AM { AM.ID } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze2 as $a where $a.ID_1_a = AM.a_struc_ID_1_a and $a.ID_1_b = AM.a_struc_ID_1_b
                                                       and $a.ID_2_a = AM.a_struc_ID_2_a and $a.ID_2_b = AM.a_struc_ID_2_b
      )`)
    })

    it('... managed association with explicit simple FKs', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID } where exists a_strucX`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.AssocMaze1 as AM { AM.ID } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze2 as $a where $a.a = AM.a_strucX_a and $a.b = AM.a_strucX_b
      )`)
    })

    it('... managed association with explicit structured FKs', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID } where exists a_strucY`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.AssocMaze1 as AM { AM.ID } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze2 as $a where $a.S_1_a = AM.a_strucY_S_1_a and $a.S_1_b = AM.a_strucY_S_1_b
                                                        and $a.S_2_a = AM.a_strucY_S_2_a and $a.S_2_b = AM.a_strucY_S_2_b
      )`)
    })

    it('... managed association with explicit structured aliased FKs', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID } where exists a_strucXA`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.AssocMaze1 as AM { AM.ID } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze2 as $a where $a.S_1_a = AM.a_strucXA_T_1_a and $a.S_1_b = AM.a_strucXA_T_1_b
                                                         and $a.S_2_a = AM.a_strucXA_T_2_a and $a.S_2_b = AM.a_strucXA_T_2_b
      )`)
    })

    it('... managed associations with FKs being managed associations', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID } where exists a_assoc`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.AssocMaze1 as AM { AM.ID } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze3 as $a where $a.assoc1_ID_1_a = AM.a_assoc_assoc1_ID_1_a and $a.assoc1_ID_1_b = AM.a_assoc_assoc1_ID_1_b
                                                       and $a.assoc1_ID_2_a = AM.a_assoc_assoc1_ID_2_a and $a.assoc1_ID_2_b = AM.a_assoc_assoc1_ID_2_b
                                                       and $a.assoc2_ID_1_a = AM.a_assoc_assoc2_ID_1_a and $a.assoc2_ID_1_b = AM.a_assoc_assoc2_ID_1_b
                                                       and $a.assoc2_ID_2_a = AM.a_assoc_assoc2_ID_2_a and $a.assoc2_ID_2_b = AM.a_assoc_assoc2_ID_2_b
      )`)
    })

    it('... managed association with explicit FKs being managed associations', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID } where exists a_assocY`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.AssocMaze1 as AM { AM.ID } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze2 as $a where $a.A_1_a = AM.a_assocY_A_1_a and $a.A_1_b_ID = AM.a_assocY_A_1_b_ID
                                                        and $a.A_2_a = AM.a_assocY_A_2_a and $a.A_2_b_ID = AM.a_assocY_A_2_b_ID
      )`)
    })

    it('... managed association with explicit aliased FKs being managed associations', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID } where exists a_assocYA`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.AssocMaze1 as AM { AM.ID } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze2 as $a where $a.A_1_a = AM.a_assocYA_B_1_a and $a.A_1_b_ID = AM.a_assocYA_B_1_b_ID
                                                         and $a.A_2_a = AM.a_assocYA_B_2_a and $a.A_2_b_ID = AM.a_assocYA_B_2_b_ID
      )`)
    })

    it('... managed associations with FKs being mix of struc and managed assoc', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID } where exists a_strass`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.AssocMaze1 as AM { AM.ID } WHERE EXISTS (
        SELECT 1 from bookshop.AssocMaze4 as $a where $a.A_1_a= AM.a_strass_A_1_a
                                                        and $a.A_1_b_assoc1_ID_1_a = AM.a_strass_A_1_b_assoc1_ID_1_a and $a.A_1_b_assoc1_ID_1_b = AM.a_strass_A_1_b_assoc1_ID_1_b
                                                        and $a.A_1_b_assoc1_ID_2_a = AM.a_strass_A_1_b_assoc1_ID_2_a and $a.A_1_b_assoc1_ID_2_b = AM.a_strass_A_1_b_assoc1_ID_2_b
                                                        and $a.A_1_b_assoc2_ID_1_a = AM.a_strass_A_1_b_assoc2_ID_1_a and $a.A_1_b_assoc2_ID_1_b = AM.a_strass_A_1_b_assoc2_ID_1_b
                                                        and $a.A_1_b_assoc2_ID_2_a = AM.a_strass_A_1_b_assoc2_ID_2_a and $a.A_1_b_assoc2_ID_2_b = AM.a_strass_A_1_b_assoc2_ID_2_b
                                                        and $a.A_2_a = AM.a_strass_A_2_a
                                                        and $a.A_2_b_assoc1_ID_1_a = AM.a_strass_A_2_b_assoc1_ID_1_a and  $a.A_2_b_assoc1_ID_1_b = AM.a_strass_A_2_b_assoc1_ID_1_b
                                                        and $a.A_2_b_assoc1_ID_2_a = AM.a_strass_A_2_b_assoc1_ID_2_a and  $a.A_2_b_assoc1_ID_2_b = AM.a_strass_A_2_b_assoc1_ID_2_b
                                                        and $a.A_2_b_assoc2_ID_1_a = AM.a_strass_A_2_b_assoc2_ID_1_a and  $a.A_2_b_assoc2_ID_1_b = AM.a_strass_A_2_b_assoc2_ID_1_b
                                                        and $a.A_2_b_assoc2_ID_2_a = AM.a_strass_A_2_b_assoc2_ID_2_a and  $a.A_2_b_assoc2_ID_2_b = AM.a_strass_A_2_b_assoc2_ID_2_b
      )`)
    })

    // TODO test with ...FKs being managed assoc with explicit aliased FKs
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

  it('... in select', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books {ID, genre[exists children].descr }`, model)
    expect(query).to.deep.equal(
      cds.ql`SELECT from bookshop.Books as $B
        LEFT OUTER JOIN bookshop.Genres as genre ON genre.ID = $B.genre_ID
          and EXISTS (
            SELECT 1 from bookshop.Genres as $c where $c.parent_ID = genre.ID
          )
        { $B.ID, genre.descr as genre_descr }`,
    )
  })

  it('... in select, nested', () => {
    let query = cqn4sql(cds.ql`SELECT from bookshop.Books {ID, genre[exists children[exists children]].descr }`, model)
    expect(query).to.deep.equal(
      cds.ql`SELECT from bookshop.Books as $B
        LEFT OUTER JOIN bookshop.Genres as genre ON genre.ID = $B.genre_ID
          and EXISTS (
            SELECT 1 from bookshop.Genres as $c where $c.parent_ID = genre.ID
            and EXISTS (
              SELECT 1 from bookshop.Genres as $c2 where $c2.parent_ID = $c.ID
            )
          )
        { $B.ID, genre.descr as genre_descr }`,
    )
  })

  it('... in select, path with 2 assocs', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Books {ID, genre[exists children[code=2]].children[exists children[code=3]].descr }`,
      model,
    )
    expect(query).to.deep.equal(
      cds.ql`SELECT from bookshop.Books as $B
        LEFT OUTER JOIN bookshop.Genres as genre ON genre.ID = $B.genre_ID
          and EXISTS (
            SELECT 1 from bookshop.Genres as $c where $c.parent_ID = genre.ID
            and $c.code = 2
          )
        LEFT OUTER JOIN bookshop.Genres as children ON children.parent_ID = genre.ID
          and EXISTS (
            SELECT 1 from bookshop.Genres as $c2 where $c2.parent_ID = children.ID
            and $c2.code = 3
          )
      { $B.ID, children.descr as genre_children_descr }`,
    )
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
    model = cds.model = await cds.load(__dirname + '/A2J/schema').then(cds.linked)
  })

  it('OData lambda where exists comparing managed assocs', () => {
    const query = cqn4sql(cds.ql`SELECT from a2j.Foo as Foo { ID } where exists buz`, model)
    const expected = cds.ql`
      SELECT from a2j.Foo as Foo {
        Foo.ID
      } where exists (
        SELECT 1 FROM a2j.Buz as $b
          where ($b.bar_ID = Foo.bar_ID AND $b.bar_foo_ID = Foo.bar_foo_ID) and $b.foo_ID = Foo.ID
      )
    `
    expect(query).to.eql(expected)
  })
  it('OData lambda where exists comparing managed assocs with renamed keys', () => {
    const query = cqn4sql(cds.ql`SELECT from a2j.Foo as Foo { ID } where exists buzRenamed`, model)
    const expected = cds.ql`
      SELECT from a2j.Foo as Foo {
        Foo.ID
      } where exists (
        SELECT 1 FROM a2j.Buz as $b
          where ($b.barRenamed_renameID = Foo.barRenamed_renameID AND $b.barRenamed_foo_ID = Foo.barRenamed_foo_ID) and $b.foo_ID = Foo.ID
      )
    `
    expect(query).to.eql(expected)
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

describe('Sanity checks for `exists` predicate', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/srv/cat-service').then(cds.linked)
  })
  it('rejects $self following exists predicate', () => {
    expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID, author } where exists $self.author`, model)).to.throw(
      'Paths starting with “$self” must not contain steps of type “cds.Association”: ref: [ $self, author ]',
    )
  })

  it('rejects non assoc following exists predicate', () => {
    expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID, author[exists name].name as author }`, model)).to.throw(
      'Expecting path “name” following “EXISTS” predicate to end with association/composition, found “cds.String”',
    )
  })

  it('rejects non assoc following exists predicate in scoped query', () => {
    expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books:author[exists name] { ID }`, model)).to.throw(
      'Expecting path “name” following “EXISTS” predicate to end with association/composition, found “cds.String”',
    )
  })

  it('rejects non assoc following exists predicate in where', () => {
    expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID } where exists author[exists name]`, model)).to.throw(
      'Expecting path “name” following “EXISTS” predicate to end with association/composition, found “cds.String”',
    )
  })

  it('rejects non assoc at leaf of path following exists predicate', () => {
    expect(() =>
      cqn4sql(cds.ql`SELECT from bookshop.Books { ID, author[exists books.title].name as author }`, model),
    ).to.throw(
      'Expecting path “books.title” following “EXISTS” predicate to end with association/composition, found “cds.String”',
    )
  })
})

describe('path expression within infix filter following exists predicate', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/srv/cat-service').then(cds.linked)
  })

  it('via managed association', () => {
    let query = cds.ql`SELECT from bookshop.Authors as Authors { ID } where exists books[genre.name = 'Thriller']`

    const transformed = cqn4sql(query, model)
    expect(transformed).to.deep.equal(
      cds.ql`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE EXISTS (
        SELECT 1 from bookshop.Books as $b
        inner join bookshop.Genres as genre on genre.ID = $b.genre_ID
        where $b.author_ID = Authors.ID and genre.name = 'Thriller'
      )`,
    )
  })
  it('via managed association multiple assocs', () => {
    let query = cds.ql`SELECT from bookshop.Authors as Authors { ID } where exists books.author.books[genre.parent.name = 'Thriller']`

    const transformed = cqn4sql(query, model)
    expect(transformed).to.deep.equal(
      cds.ql`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE EXISTS (
        SELECT 1 from bookshop.Books as $b
        where $b.author_ID = Authors.ID and EXISTS (

          SELECT 1 from bookshop.Authors as $a
          where $a.ID = $b.author_ID and EXISTS (

            SELECT 1 from bookshop.Books as $b2
            inner join bookshop.Genres as genre on genre.ID = $b2.genre_ID
            inner join bookshop.Genres as parent on parent.ID = genre.parent_ID
            where $b2.author_ID = $a.ID and parent.name = 'Thriller'

          )

        )
      )`,
    )
  })
  it('via managed association, hidden in a function', () => {
    let query = cds.ql`SELECT from bookshop.Authors as Authors { ID } where exists books[toLower(genre.name) = 'thriller']`

    const transformed = cqn4sql(query, model)
    expect(transformed).to.deep.equal(
      cds.ql`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE EXISTS (
        SELECT 1 from bookshop.Books as $b
        inner join bookshop.Genres as genre on genre.ID = $b.genre_ID
        where $b.author_ID = Authors.ID and toLower(genre.name) = 'thriller'
      )`,
    )
  })
  it('via unmanaged association', () => {
    // match all authors which have co-authored at least one book with King
    let query = cds.ql`SELECT from bookshop.Authors as Authors { ID } where exists books[coAuthorUnmanaged.name = 'King']`

    const transformed = cqn4sql(query, model)
    expect(transformed).to.deep.equal(
      cds.ql`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE EXISTS (
        SELECT 1 from bookshop.Books as $b
        inner join bookshop.Authors as coAuthorUnmanaged on coAuthorUnmanaged.ID = $b.coAuthor_ID_unmanaged
        where $b.author_ID = Authors.ID and coAuthorUnmanaged.name = 'King'
      )`,
    )
  })

  it('nested exists', () => {
    let query = cds.ql`SELECT from bookshop.Authors as Authors { ID } where exists books[toLower(genre.name) = 'thriller' and exists genre[parent.name = 'Fiction']]`

    const transformed = cqn4sql(query, model)
    expect(transformed).to.deep.equal(
      cds.ql`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE EXISTS (
        SELECT 1 from bookshop.Books as $b
        inner join bookshop.Genres as genre on genre.ID = $b.genre_ID
        where $b.author_ID = Authors.ID and toLower(genre.name) = 'thriller'
        and EXISTS (
          SELECT 1 from bookshop.Genres as $g
          inner join bookshop.Genres as parent on parent.ID = $g.parent_ID
          where $g.ID = $b.genre_ID and parent.name = 'Fiction'
        )
      )`,
    )
  })

  it('scoped query with nested exists', () => {
    let query = cds.ql`SELECT from bookshop.Authors[exists books[genre.name LIKE '%Fiction']]:books as books { ID }`

    const transformed = cqn4sql(query, model)
    expect(transformed).to.deep.equal(
      cds.ql`SELECT from bookshop.Books as books
      { books.ID }
        WHERE EXISTS (
          SELECT 1 from bookshop.Authors as $A where $A.ID = books.author_ID and
            EXISTS (
              SELECT 1 from bookshop.Books as $b
              inner join bookshop.Genres as genre on genre.ID = $b.genre_ID
              where $b.author_ID = $A.ID and genre.name LIKE '%Fiction'
            )
        )`,
    )
  })

  it('path expression embedded in xpr', () => {
    const q = cds.ql`select from bookshop.Books as Books { 1 as foo } where exists genre[('foo' || parent.name || 'bar') LIKE 'foo%bar']`
    const expected = cds.ql`SELECT from bookshop.Books as Books { 1 as foo } where exists (
      SELECT 1 from bookshop.Genres as $g
      inner join bookshop.Genres as parent on parent.ID = $g.parent_ID
      where $g.ID = Books.genre_ID and ('foo' || parent.name || 'bar') LIKE 'foo%bar'
    )`
    expect(cqn4sql(q, model)).to.deep.equal(expected)
  })

  it('rejects the path expression at the leaf of scoped queries', () => {
    // original idea was to just add the `genre.name` as where clause to the query
    // however, with left outer joins we might get too many results
    //
    // --> here we would then get all books which fulfill `genre.name = null`
    //     but also all books which have no genre at all
    //
    // if this comes up again, we might render inner joins for this node...
    let query = cds.ql`SELECT from bookshop.Authors:books[genre.name = null] { ID }`

    expect(() => cqn4sql(query, model)).to.throw(
      `Only foreign keys of “genre” can be accessed in infix filter, but found “name”`
    )
  })

  it('in case statements', () => {
    // TODO: Aliases for genre could be improved
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Authors as Authors
     { ID,
       case when exists books[toLower(genre.name) = 'Thriller' and price>10]  then 1
            when exists books[toLower(genre.name) = 'Thriller' and price>100 and exists genre] then 2
       end as descr
     }`,
      model,
    )
    expect(query).to.deep.equal(
      cds.ql`SELECT from bookshop.Authors as Authors
      { Authors.ID,
        case 
          when exists (
            select 1 from bookshop.Books as $b
            inner join bookshop.Genres as genre on genre.ID = $b.genre_ID
            where $b.author_ID = Authors.ID and toLower(genre.name) = 'Thriller' and $b.price > 10
          )
          then 1
          when exists (
            select 1 from bookshop.Books as $b2
            inner join bookshop.Genres as genre on genre.ID = $b2.genre_ID
            where $b2.author_ID = Authors.ID and toLower(genre.name) = 'Thriller' and $b2.price > 100
                  and exists (
                    select 1 from bookshop.Genres as $g where $g.ID = $b2.genre_ID
                  )
          )
          then 2
        end as descr
      }`,
    )
  })

  it('assoc is defined within a structure', () => {
    expect(
      cqn4sql(
        cds.ql`SELECT from bookshop.Authors as Authors { ID } WHERE EXISTS books[toLower(toUpper(dedication.addressee.name)) = 'Hasso']`,
        model,
      ),
    ).to.eql(
      cds.ql`SELECT from bookshop.Authors as Authors { Authors.ID }
      WHERE EXISTS (
        SELECT 1 from bookshop.Books as $b
          inner join bookshop.Person as addressee
          on addressee.ID = $b.dedication_addressee_ID
        where $b.author_ID = Authors.ID AND toLower(toUpper(addressee.name)) = 'Hasso'
      )`,
    )
  })
})
