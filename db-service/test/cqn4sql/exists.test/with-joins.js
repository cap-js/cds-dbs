'use strict'

const { loadModel } = require('../helpers/model')
const cds = require('@sap/cds')
const { expect } = cds.test
require('../helpers/test.setup')

let cqn4sql = require('../../../lib/cqn4sql')

describe('(exist predicates) with joins', () => {
  before(async () => {
    const m = await loadModel([__dirname + '/../../bookshop/db/schema'])
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, m)
  })

  describe('simple', () => {})

  describe('with filter conditions', () => {
    it('in case', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          ID,
          case when exists books[price>10]  then books[stock=1].genre[code='A'].descr
               when exists books[price>100] then books[stock=1].genre[code='B' or code='C'].descr
          end as descr
        }`)
      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
          left outer join bookshop.Books as books on books.author_ID = Authors.ID
           and books.stock = 1
          left outer join bookshop.Genres as genre on genre.ID = books.genre_ID
           and genre.code = 'A'
          left outer join bookshop.Genres as genre2 on genre2.ID = books.genre_ID
           and (genre2.code = 'B' or genre2.code = 'C')
        {
          Authors.ID,
          case when exists (
                      select 1 from bookshop.Books as $b
                      WHERE $b.author_ID = Authors.ID and $b.price > 10
                    )
               then genre.descr
               when exists (
                      select 1 from bookshop.Books as $b2
                      WHERE $b2.author_ID = Authors.ID and $b2.price > 100
                    )
               then genre2.descr
          end as descr
        }`
      expect(transformed).to.equalCqn(expected)
    })
    it('predicate inside infix filter - exists also has filter', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          ID,
          books[exists genre[code='A']].title
        }`)
      const expected = cds.ql`SELECT from bookshop.Authors as Authors
            left outer join bookshop.Books as books on books.author_ID = Authors.ID AND
              exists (
                select 1 from bookshop.Genres as $g
                WHERE $g.ID = books.genre_ID and $g.code = 'A'
              )
            {
              Authors.ID,
              books.title as books_title
            }`
      expect(transformed).to.equalCqn(expected)
    })

    it('predicate inside infix filter - exists also has filter (with OR)', () => {
      const transformed = cqn4sql(
        cds.ql`SELECT from bookshop.Authors as Authors
           { ID,
             books[exists genre[code='A' or code='B']].title
           }`,
      )
      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
          left outer join bookshop.Books as books on books.author_ID = Authors.ID
            and exists (
                  select 1 from bookshop.Genres as $g
                  WHERE $g.ID = books.genre_ID
                    and ($g.code = 'A' or $g.code = 'B')
                )
        {
          Authors.ID,
          books.title as books_title
        }`
      expect(transformed).to.equalCqn(expected)
    })
  })
})
