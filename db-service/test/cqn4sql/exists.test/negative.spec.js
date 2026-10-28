'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

const { expect } = cds.test

let cqn4sql = require('../../../lib/cqn4sql')

describe('(exist predicate) negative tests', () => {
  before(async () => {
    const m = await loadModel()
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, m)
  })

  describe('sanity checks - works only with associations', () => {
    it('rejects $self following EXISTS predicate', () => {
      expect(() =>
        cqn4sql(cds.ql`
          SELECT from bookshop.Books
          {
            ID,
            author
          }
          WHERE EXISTS $self.author
        `),
      ).to.throw('Paths starting with “$self” must not contain steps of type “cds.Association”: ref: [ $self, author ]')
    })

    it('rejects non association following EXISTS predicate', () => {
      expect(() =>
        cqn4sql(cds.ql`
          SELECT from bookshop.Books
          {
            ID,
            author[EXISTS name].name as author
          }
        `),
      ).to.throw(
        'Expecting path “name” following “EXISTS” predicate to end with association/composition, found “cds.String”',
      )
    })

    it('rejects non association following EXISTS predicate in scoped query', () => {
      expect(() =>
        cqn4sql(cds.ql`
          SELECT from bookshop.Books:author[EXISTS name]
          {
            ID
          }
        `),
      ).to.throw(
        'Expecting path “name” following “EXISTS” predicate to end with association/composition, found “cds.String”',
      )
    })

    it('rejects non association following EXISTS predicate in WHERE', () => {
      expect(() =>
        cqn4sql(cds.ql`
          SELECT from bookshop.Books
          {
            ID
          }
          WHERE EXISTS author[EXISTS name]
        `),
      ).to.throw(
        'Expecting path “name” following “EXISTS” predicate to end with association/composition, found “cds.String”',
      )
    })

    it('rejects non association at leaf of path following EXISTS predicate', () => {
      expect(() =>
        cqn4sql(cds.ql`
          SELECT from bookshop.Books
          {
            ID,
            author[EXISTS books.title].name as author
          }
        `),
      ).to.throw(
        'Expecting path “books.title” following “EXISTS” predicate to end with association/composition, found “cds.String”',
      )
    })
  })

  describe('restrictions', () => {
    // semantically equivalent to adding a where clause: the leaf path expression of a scoped
    // query is resolved via a (left) join, consistent with `SELECT from Books WHERE genre.name = null`.
    it('resolves the path expression at the leaf of scoped queries', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors:books[genre.name = null]
        {
          ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as $b
          left join bookshop.Genres as genre on genre.ID = $b.genre_ID
        {
          $b.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Authors as $A where $A.ID = $b.author_ID
        ) and genre.name = null`

      expectCqn(transformed).to.equal(expected)
    })

    it('OData shortcut notation does not work on associations with multiple foreign keys', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.AssocWithStructuredKey:toStructuredKey[42]`)).to.throw(
        `Shortcut notation “[42]” not available for composite primary key of “bookshop.WithStructuredKey”, write “<key> = 42” explicitly`,
      )
    })
  })
})
