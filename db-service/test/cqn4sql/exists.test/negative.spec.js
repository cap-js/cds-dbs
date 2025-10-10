'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')

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
    // semantically equivalent to adding a where clause..
    // IMO artificially rejecting this is not necessary, we can solve this uniformly also for regular where clause
    it.skip('rejects the path expression at the leaf of scoped queries', () => {
      // original idea was to just add the `genre.name` as WHERE clause to the query
      // however, with left outer joins we might get too many results
      //
      // --> here we would then get all books which fulfill `genre.name = null`
      //     but also all books which have no genre at all
      //
      // if this comes up again, we might render inner joins for this node...
      const query = cds.ql`
        SELECT from bookshop.Authors:books[genre.name = null]
        {
          ID
        }`

      expect(() => cqn4sql(query)).to.throw(
        'Only foreign keys of “genre” can be accessed in infix filter, but found “name”',
      )
    })

    // (SMW) msg not good -> filter in general is ok for assoc with multiple FKS,
    // only shortcut notation is not allowed
    // TODO: message is BAD, it could include the fix: `write ”<key> = 42” explicitly`
    it('OData shortcut notation does not work on associations with multiple foreign keys', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.AssocWithStructuredKey:toStructuredKey[42]`)).to.throw(
        /Filters can only be applied to managed associations which result in a single foreign key/,
      )
    })
  })
})
