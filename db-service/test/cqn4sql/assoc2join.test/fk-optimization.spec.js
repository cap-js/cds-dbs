'use strict'

const { loadModel } = require('../helpers/model')
const cds = require('@sap/cds')
const { expect } = cds.test
require('../helpers/test.setup')

let cqn4sql = require('../../../lib/cqn4sql')

describe('(a2j) fk detection', () => {
  before(async () => {
    const model = await loadModel([__dirname + '/../../bookshop/db/schema'])
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, model)
  })

  describe('simple', () => {
    it('follow managed assoc, select FK', () => {
      const query = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { author.ID }`)
      const expected = cds.ql`
	  	SELECT from bookshop.Books as Books
		  {
		    Books.author_ID
		  }`
      expect(query).to.equalCqn(expected)
    })
    it('follow managed assoc, select FK and other field', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { author.ID, author.name }`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
        {
          Books.author_ID,
          author.name as author_name
        }`
      expect(transformed).to.equalCqn(expected)
    })
    it('select managed assoc with structured foreign key', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Intermediate as Intermediate
        {
          ID,
          toAssocWithStructuredKey.toStructuredKey
        }`)
      const expected = cds.ql`
        SELECT from bookshop.Intermediate as Intermediate
          left outer join bookshop.AssocWithStructuredKey as toAssocWithStructuredKey on toAssocWithStructuredKey.ID = Intermediate.toAssocWithStructuredKey_ID
        {
          Intermediate.ID,
          toAssocWithStructuredKey.toStructuredKey_struct_mid_leaf as toAssocWithStructuredKey_toStructuredKey_struct_mid_leaf,
          toAssocWithStructuredKey.toStructuredKey_struct_mid_anotherLeaf as toAssocWithStructuredKey_toStructuredKey_struct_mid_anotherLeaf,
          toAssocWithStructuredKey.toStructuredKey_second as toAssocWithStructuredKey_toStructuredKey_second
        }`
      expect(transformed).to.equalCqn(expected)
    })
  })

  describe('prefix is join relevant', () => {
    it('follow managed assoc, select FK', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Authors as Authors { ID, books.genre.ID }`)
      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
          left outer join bookshop.Books as books on books.author_ID = Authors.ID
        {
          Authors.ID,
          books.genre_ID as books_genre_ID
        }`
      expect(transformed).to.equalCqn(expected)
    })
    it('select managed assoc', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Authors as Authors { ID, books.genre.ID }`)
      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
          left outer join bookshop.Books as books on books.author_ID = Authors.ID
        {
          Authors.ID,
          books.genre_ID as books_genre_ID
        }`
      expect(transformed).to.equalCqn(expected)
    })

    it('three assocs, last navigates to foreign key', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Authors as Authors { ID, books.genre.parent.ID as foo }`)
      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
          left outer join bookshop.Books as books on books.author_ID = Authors.ID
          left outer join bookshop.Genres as genre on genre.ID = books.genre_ID
        { 
          Authors.ID, 
          genre.parent_ID as foo
        }`
      expect(transformed).to.equalCqn(expected)
    })
  })
})
