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
    it('breakout of infix filter - resolve $main in exists subquery', () => {
      // the first column checks if the author of the current book
      // has already written other books with a similar title
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          (
            exists author.books[ contains(title, $main.title) ] ?
              'This author has already written similar books' :
              'No similar books by this author'
          ) as hasSimilarBooks
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          (
            CASE
            WHEN EXISTS
              (
                SELECT 1 from bookshop.Authors as $a
                where $a.ID = Books.author_ID
                and EXISTS (
                    SELECT 1 from bookshop.Books as $b
                    where $b.author_ID = $a.ID
                      and contains($b.title, Books.title)
                  )
              )
            THEN 'This author has already written similar books'
            ELSE 'No similar books by this author'
            END
          ) as hasSimilarBooks
        }`
      expectCqn(transformed).to.equal(expected)
    })

    it('breakout of infix filter - resolve $main in join on condition', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          author.books[ contains(title, $main.title) and ID != $main.ID ].title as similarBookTitle
        }`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left join bookshop.Authors as author on author.ID = Books.author_ID
          left join bookshop.Books as books2
            on books2.author_ID = author.ID and
               contains(books2.title, Books.title) and books2.ID != Books.ID
        {
          books2.title as similarBookTitle
        }`
      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('general behavior', () => {
    it('shared prefix with outer query', () => {
      // the `$main.genre.name` re-uses the join which is
      // generated for the `genre.name` column in the outer query
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

    it('behaves like table alias in outermost projection', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          $main.title,
          $main.author.name
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        left join bookshop.Authors as author on author.ID = Books.author_ID
        {
          Books.title,
          author.name as author_name
        }`
      expectCqn(transformed).to.equal(expected)
    })

    it('behaves like table alias in outermost projection - shared prefix', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          $main.title,
          $main.author.name
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        left join bookshop.Authors as author on author.ID = Books.author_ID
        {
          Books.title,
          author.name as author_name
        }`
      expectCqn(transformed).to.equal(expected)
    })

    it('access $main in from clause', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books[$main.books.title = title]:author as author
        {
          books.title as sharedBookJoin
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as author
        left join bookshop.Books as books on books.author_ID = author.ID
        {
          books.title as sharedBookJoin
        }
        where exists (
          SELECT 1 from bookshop.Books as $B
          where $B.author_ID = author.ID and books.title = $B.title
        )
        `
      expectCqn(transformed).to.equal(expected)
    })

    it('access $main in from clause nested', () => {
      // select all Genres with a "grandParent" that share it's name with the "grandKid"
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Genres[$main.name = name]:parent.parent as grandParent
        {
          grandParent.name as grandParentName,
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Genres as grandParent
        {
          grandParent.name as grandParentName,
        }
        where exists (
          SELECT 1 from bookshop.Genres as $p
          where $p.parent_ID = grandParent.ID and exists (
            SELECT 1 from bookshop.Genres as $G
            where $G.parent_ID = $p.ID and grandParent.name = $G.name
          )
        )
      `
      expectCqn(transformed).to.equal(expected)
    })
  })
})
