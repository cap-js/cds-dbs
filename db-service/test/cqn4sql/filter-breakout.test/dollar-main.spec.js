/**
 * FOR INTERNAL USAGE ONLY!
 *
 * resolve a $main variable always to the most outer query scope
 */
'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('internal $main variable', () => {
  before(async () => {
    const m = await loadModel()
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, m)
  })

  describe('assert cases', () => {
    it('breakout of infix filter', () => {
      // the first column checks if the author of the current book
      // has already written other books with a similar title
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ( (exists author.books[ contains(title, $main.title) ]) ?
            'This author has already written similar books' :
            'No similar books by this author'
          ) as hasSimilarBooks
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          ( CASE WHEN
           (
            EXISTS (
              SELECT 1 from bookshop.Authors as $a
              where $a.ID = Books.author_ID and EXISTS (
                SELECT 1 from bookshop.Books as $b
                where $b.author_ID = $a.ID
                  and contains($b.title, Books.title)
              )
            )
          )
            THEN 'This author has already written similar books'
            ELSE 'No similar books by this author'
            END
          ) as hasSimilarBooks
        }`
      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('general behavior', () => {
    it('shared prefix with outer query', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          genre.name as genre,
          (exists author.books[ contains(genre.name, $main.genre.name) ] ? true : false) as hasBooksWithSimilarGenres
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        left join bookshop.Genres as genre on genre.ID = Books.genre_ID
        {
          genre.name as genre,
          (
            CASE
            WHEN EXISTS
              (
                SELECT 1 from bookshop.Authors as $a
                where $a.ID = Books.author_ID and
                EXISTS (
                  SELECT 1 from bookshop.Books as $b
                  inner join bookshop.Genres as genre2 on genre2.ID = $b.genre_ID
                  where $b.author_ID = $a.ID
                    and contains(genre2.name, genre.name)
                )
              )
            THEN true
            ELSE false
            END
          )
          as hasBooksWithSimilarGenres
        }
      `
      expectCqn(transformed).to.equal(expected)
    })

    it('even inside a subquery, we always resolve to the outermost source', () => {
      // in the nested subquery, $main still refers to `Books` - not to `Books2` nor `author`
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          (
            SELECT 1 from bookshop.Authors as author
            where author.ID = Books.author.ID
            and exists (
              SELECT 1 from bookshop.Books as Books2
              where Books2.author.ID = author.ID and
                    contains(Books2.title, $main.title)
            )
          ) as handWrittenExists
        }`)
      
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          (
            SELECT 1 from bookshop.Authors as author
            where author.ID = Books.author_ID
            and EXISTS (
              SELECT 1 from bookshop.Books as Books2
              where Books2.author_ID = author.ID
                and contains(Books2.title, Books.title)
            )
          ) as handWrittenExists
        }`
      expectCqn(transformed).to.equal(expected)
    })
  })
})
