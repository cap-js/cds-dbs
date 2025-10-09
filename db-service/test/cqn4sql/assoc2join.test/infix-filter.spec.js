'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn, expect } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('(a2j) in infix filter', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, model)
  })

  describe('simple', () => {
    it('managed assoc', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          author[placeOfBirth='Marbach'].name
        }`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
            and author.placeOfBirth = 'Marbach'
        {
          Books.ID,
          author.name as author_name
        }`
      expectCqn(transformed).to.equal(expected)
    })
    it('managed assoc within structure', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          dedication.addressee[name = 'Hasso'].name
        }`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Person as addressee on addressee.ID = Books.dedication_addressee_ID
            and addressee.name = 'Hasso'
        {
          Books.ID,
          addressee.name as dedication_addressee_name
        }`
      expectCqn(transformed).to.equal(expected)
    })

    it('key in filter - retrieve from target in on-condition', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID, author[ID=2].name }`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
            and author.ID = 2
        {
          Books.ID,
          author.name as author_name
        }`
      expectCqn(transformed).to.equal(expected)
    })

    it('columns need aliases - even with different filter conditions', () => {
      // TODO: belongs somewhere else
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID, author[ID=1].name, author[ID=2].name }`)).to.throw(
        /Duplicate definition of element “author_name”/,
      )
    })

    it('complex condition wrapped as expression', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          author[placeOfBirth='Marbach' OR placeOfDeath='Marbach'].name
        }`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
            and (author.placeOfBirth = 'Marbach' OR author.placeOfDeath = 'Marbach')
        {
          Books.ID,
          author.name as author_name
        }`
      expectCqn(transformed).to.equal(expected)
    })

    it('no fk optimization after infix filter', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          title,
          author[name='Mr. X' or name = 'Mr. Y'].ID
        }`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
            and (author.name='Mr. X' or author.name = 'Mr. Y')
        {
          Books.title,
          author.ID as author_ID
        }`
      expectCqn(transformed).to.equal(expected)
    })

    it('different filter conditions lead to independent joins ', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          author[placeOfBirth='Marbach'].ID as aID1
        }
        HAVING author[placeOfBirth='Foobach'].ID and genre[parent.ID='fiction'].ID`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
            and author.placeOfBirth = 'Marbach'
          left outer join bookshop.Authors as author2 on author2.ID = Books.author_ID
            and author2.placeOfBirth = 'Foobach'
          left outer join bookshop.Genres as genre on genre.ID = Books.genre_ID
            and genre.parent_ID = 'fiction'
        {
          Books.ID,
          author.ID as aID1
        }
        HAVING author2.ID and genre.ID
          `
      expectCqn(transformed).to.equal(expected)
    })

    it('same path with and without filter lead to independent joins', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          author[placeOfBirth='Marbach'].name as n1,
          author.name as n2
        }`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
            and author.placeOfBirth = 'Marbach'
          left outer join bookshop.Authors as author2 on author2.ID = Books.author_ID
        {
          Books.ID,
          author.name as n1,
          author2.name as n2
        }`
      expectCqn(transformed).to.equal(expected)
    })

    it('shared filter conditions lead to shared joins', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          author[placeOfBirth='Marbach'].name as n1,
          author[placeOfBirth='Erfurt'].name as n2,
          author[placeOfBirth='Marbach'].dateOfBirth as d1,
          author[placeOfBirth='Erfurt'].dateOfBirth as d2
        }`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
           and author.placeOfBirth = 'Marbach'
          left outer join bookshop.Authors as author2 on author2.ID = Books.author_ID
           and author2.placeOfBirth = 'Erfurt'
        { Books.ID,
          author.name as n1,
          author2.name as n2,
          author.dateOfBirth as d1,
          author2.dateOfBirth as d2
        }`
      expectCqn(transformed).to.equal(expected)
    })

    it('reversed filter conditions lead to independent joins', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          author[placeOfBirth='Marbach'].name as n1,
          author['Marbach'=placeOfBirth].name as n2
        }`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
           and author.placeOfBirth = 'Marbach'
          left outer join bookshop.Authors as author2 on author2.ID = Books.author_ID
           and 'Marbach' = author2.placeOfBirth
        {
          Books.ID,
          author.name as n1,
          author2.name as n2
        }`
      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('shared prefix', () => {
    it('same filter at first association navigation, different at second - shared base join', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          ID,
          books[stock=1].genre[code='A'].descr as d1,
          books[stock=1].genre[code='B'].descr as d2
        }`)
      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
          left outer join bookshop.Books as books on books.author_ID = Authors.ID
           and books.stock = 1
          left outer join bookshop.Genres as genre on genre.ID = books.genre_ID
           and genre.code = 'A'
          left outer join bookshop.Genres as genre2 on genre2.ID = books.genre_ID
           and genre2.code = 'B'
        {
          Authors.ID,
          genre.descr as d1,
          genre2.descr as d2
        }`
      expectCqn(transformed).to.equal(expected)
    })
    it('same filter at all associations - shared joins', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          ID,
          books[stock=1].genre[code='A'].descr as d1,
          books[stock=1].genre[code='A'].descr as d2
        }`)
      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
          left outer join bookshop.Books as books on books.author_ID = Authors.ID
            and books.stock = 1
          left outer join bookshop.Genres as genre on genre.ID = books.genre_ID
            and genre.code = 'A'
        {
          Authors.ID,
          genre.descr as d1,
          genre.descr as d2
        }`
      expectCqn(transformed).to.equal(expected)
    })
    it('same filter only in last association navigation - independent joins', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          ID,
          books[stock=1].genre[code='A'].descr as d1,
          books[stock=2].genre[code='A'].descr as d2
        }`)
      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
          left outer join bookshop.Books as books on books.author_ID = Authors.ID
           and books.stock = 1
          left outer join bookshop.Genres as genre on genre.ID = books.genre_ID
           and genre.code = 'A'
          left outer join bookshop.Books as books2 on books2.author_ID = Authors.ID
           and books2.stock = 2
          left outer join bookshop.Genres as genre2 on genre2.ID = books2.genre_ID
           and genre2.code = 'A'
        {
          Authors.ID,
          genre.descr as d1,
          genre2.descr as d2
        }`
      expectCqn(transformed).to.equal(expected)
    })

    it('same filter at first association, different at second (in where) - shared base join', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          ID,
          books[stock=1].genre[code='A'].descr
        }
        WHERE books[stock=1].genre[code='B'].descr = 'foo'`)
      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
          left outer join bookshop.Books as books on books.author_ID = Authors.ID AND books.stock = 1
          left outer join bookshop.Genres as genre on genre.ID = books.genre_ID AND genre.code = 'A'
          left outer join bookshop.Genres as genre2 on genre2.ID = books.genre_ID AND genre2.code = 'B'
        {
          Authors.ID,
          genre.descr as books_genre_descr
        }
        WHERE genre2.descr = 'foo'`
      expectCqn(transformed).to.equal(expected)
    })

    it('same filter at first association, different at second (in case when) - shared base join', () => {
      let transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          ID,
          case when ID<4 then books[stock=1].genre[code='A'].descr
               when ID>4 then books[stock=1].genre[code='B'].descr
          end as descr
        }`)
      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
          left outer join bookshop.Books as books on books.author_ID = Authors.ID AND books.stock = 1
          left outer join bookshop.Genres as genre on genre.ID = books.genre_ID AND genre.code = 'A'
          left outer join bookshop.Genres as genre2 on genre2.ID = books.genre_ID AND genre2.code = 'B'
        {
          Authors.ID,
          case when Authors.ID<4 then genre.descr
               when Authors.ID>4 then genre2.descr
          end as descr
        }`
      expectCqn(transformed).to.equal(expected)
    })

    it('same filter at assoc in having', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          author[placeOfBirth='Marbach'].name
        }
        HAVING author[placeOfBirth='Marbach'].name = 'King'`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
           and author.placeOfBirth = 'Marbach'
          {
            Books.ID,
            author.name as author_name
          }
          HAVING author.name = 'King'`
      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('path expressions in filter', () => {
    it('puts the filter condition into a correlated subquery in the on-condition of the join', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          title,
          author.name
        }
        WHERE startswith( author[books.genre.name = 'Drama'].name, 'Emily' )
      `)
      const expected = cds.ql`
        SELECT from bookshop.Books as $B
          left join bookshop.Authors as author on author.ID = $B.author_ID

          left join bookshop.Authors as author2
          on author2.ID = $B.author_ID and exists (
              SELECT from bookshop.Authors as $A
              inner join bookshop.Books as books on books.author_ID = $A.ID
              inner join bookshop.Genres as genre on genre.ID = books.genre_ID
              {
                1 as dummy
              }
              where genre.name = 'Drama' AND $A.ID = author2.ID
            )
        {
          $B.title,
          author.name as author_name
        }
        WHERE startswith( author2.name, 'Emily' )
      `
      expectCqn(transformed).to.equal(expected)
    })
  })
})
