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
})
