'use strict'

require('../helpers/expectCqn')
const { loadModel } = require('../helpers/model')
const cds = require('@sap/cds')
const { expect } = cds.test

let cqn4sql = require('../../../lib/cqn4sql')

describe('(a2j) path detection', () => {
  before(async () => {
    const m = await loadModel([__dirname + '/../../bookshop/db/schema'])
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, m)
  })

  describe('in where', () => {
    it('in expression', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID
        }
        WHERE ((author.name + 's') = 'Schillers') or ((author.name + 's') = 'Goethes')`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
        {
          Books.ID
        }
        WHERE ((author.name + 's') = 'Schillers') or ((author.name + 's') = 'Goethes')`
      expect(transformed).to.equalCqn(expected)
    })

    it('in list', () => {
      const transformed = cqn4sql(
        cds.ql`SELECT from bookshop.Books as Books { ID } where (author.name, 1) in ('foo', 'bar')`,
      )
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
        {
          Books.ID
        }
        WHERE (author.name, 1) in ('foo', 'bar')`
      expect(transformed).to.equalCqn(expected)
    })

    it('in tuple within list', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        { 
          ID
        }
        WHERE ((author.name, genre.name), 1) in (('foo', 1), ('bar', 2))`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
          left outer join bookshop.Genres as genre on genre.ID = Books.genre_ID
        {
          Books.ID
        }
        WHERE ((author.name, genre.name), 1) in (('foo', 1), ('bar', 2))`
      expect(transformed).to.equalCqn(expected)
    })
  })

  describe('in having', () => {
    it('in list', () => {
      const query = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID } having (author.name, 1) in ('foo', 'bar')`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
        {
          Books.ID
        }
        HAVING (author.name, 1) in ('foo', 'bar')`
      expect(query).to.deep.equal(expected)
    })
  })
})
