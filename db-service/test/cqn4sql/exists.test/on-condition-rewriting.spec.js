'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('(exist predicate) on-condition construction for semi-join in subquery', () => {
  before(async () => {
    const m = await loadModel()
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, m)
  })

  describe('unmanaged', () => {
    it('assoc navigation in on-condition', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.TestPublisher:texts
        {
          ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.TestPublisher.texts as $t
        {
          $t.ID
        }
        WHERE exists (
          SELECT 1 from bookshop.TestPublisher as $T2
          where $t.publisher_structuredKey_ID = $T2.publisher_structuredKey_ID
        )`

      expectCqn(transformed).to.equal(expected)
    })

    // TODO: infix filter with association with structured foreign key
    it.skip('assoc navigation in on-condition renamed', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.TestPublisher:textsRenamedPublisher
        {
          ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.TestPublisher.texts as textsRenamedPublisher
        {
          textsRenamedPublisher.ID
        }
        WHERE exists (
          SELECT 1 from bookshop.TestPublisher as $T2
          where textsRenamedPublisher.publisherRenamedKey_notID = $T2.publisherRenamedKey_notID
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('$self in both sides of on-condition', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books:coAuthorUnmanaged
        {
          name
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as $c
        {
          $c.name
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B
          where $c.ID = $B.coAuthor_ID_unmanaged
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('association-like calculated element', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors:booksWithALotInStock as booksWithALotInStock
        {
          booksWithALotInStock.ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as booksWithALotInStock {
          booksWithALotInStock.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Authors as $A
          where ($A.ID = booksWithALotInStock.author_ID) and (booksWithALotInStock.stock > 100)
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('`texts` composition', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books:texts
        {
          locale
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books.texts as $t
        {
          $t.locale
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B
          where $t.ID = $B.ID
        )`

      expectCqn(transformed).to.equal(expected)
    })
  })
})
