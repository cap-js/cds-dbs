'use strict'

require('../helpers/expectCqn')
const { loadModel } = require('../helpers/model')
const cds = require('@sap/cds')
const { expect } = cds.test

let cqn4sql = require('../../../lib/cqn4sql')

describe('(a2j) in columns', () => {
  before(async () => {
    const m = await loadModel([__dirname + '/../../bookshop/db/schema'])
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, m)
  })

  describe('simple', () => {
    it('path ends in scalar', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID, author.name }`)
      const expected = cds.ql`
				SELECT from bookshop.Books as Books
				left outer join bookshop.Authors as author on author.ID = Books.author_ID
				{
					Books.ID,
					author.name as author_name
				}`
      expect(transformed).to.equalCqn(expected)
    })
    it('path ends in structure', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.EStrucSibling as EStrucSibling { ID, self.struc1 }`)
      const expected = cds.ql`
				SELECT from bookshop.EStrucSibling as EStrucSibling
					left outer join bookshop.EStrucSibling as self on self.ID = EStrucSibling.self_ID
				{
					EStrucSibling.ID,
					self.struc1_deeper_foo as  self_struc1_deeper_foo,
					self.struc1_deeper_bar as  self_struc1_deeper_bar
				}`
      expect(transformed).equalCqn(expected)
    })

    it('assoc is within structure', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID, dedication.addressee.name }`)
      const expected = cds.ql`
				SELECT from bookshop.Books as Books
					left outer join bookshop.Person as addressee on addressee.ID = Books.dedication_addressee_ID
				{
					Books.ID,
					addressee.name as dedication_addressee_name
				}`
      expect(transformed).to.equalCqn(expected)
    })

    it('path via multiple assocs', () => {
      let query = cqn4sql(
        cds.ql`
					SELECT from bookshop.Authors as Authors
					{
						name,
						books.genre.descr,
						books.title as books_title,
						books.genre.code as books_genre_code
					}`,
      )
      const expected = cds.ql`
				SELECT from bookshop.Authors as Authors
					left outer join bookshop.Books as books on books.author_ID = Authors.ID
					left outer join bookshop.Genres as genre on genre.ID = books.genre_ID
				{
					Authors.name,
					genre.descr as books_genre_descr,
					books.title as books_title,
					genre.code as books_genre_code
				}`

      expect(query).to.equalCqn(expected)
    })

    it('respect explicit column alias', () => {
      const transformed = cqn4sql(
        cds.ql`
					SELECT from bookshop.Authors as Authors
					{
						name,
						books.genre.descr as foo,
						books.title as books_title,
						books.genre.code as books_genre_code
					}`,
      )
      const expected = cds.ql`
				SELECT from bookshop.Authors as Authors
					left outer join bookshop.Books as books on books.author_ID = Authors.ID
					left outer join bookshop.Genres as genre on genre.ID = books.genre_ID
				{
					Authors.name,
					genre.descr as foo,
					books.title as books_title,
					genre.code as books_genre_code
				}`
      expect(transformed).equalCqn(expected)
    })

    it('different paths with different assocs', () => {
      const transformed = cqn4sql(
        cds.ql`
					SELECT from bookshop.Books as Books 
					{
						ID,
						author.name, genre.descr,
						dedication.addressee.name,
						author.dateOfBirth
					}`,
      )
      const expected = cds.ql`
				SELECT from bookshop.Books as Books
					left outer join bookshop.Authors as author on author.ID = Books.author_ID
					left outer join bookshop.Genres as genre on genre.ID = Books.genre_ID
					left outer join bookshop.Person as addressee on addressee.ID = Books.dedication_addressee_ID
				{ Books.ID,
					author.name as author_name,
					genre.descr as genre_descr,
					addressee.name as dedication_addressee_name,
					author.dateOfBirth as author_dateOfBirth
				}`
      expect(transformed).to.equalCqn(expected)
    })

    it('different paths with different assocs with same target', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID, author.name, coAuthor.name }`)
      const expected = cds.ql`
				SELECT from bookshop.Books as Books
					left outer join bookshop.Authors as author on author.ID = Books.author_ID
					left outer join bookshop.Authors as coAuthor on coAuthor.ID = Books.coAuthor_ID
				{
					Books.ID,
					author.name as author_name,
					coAuthor.name as coAuthor_name
				}`
      expect(transformed).to.equalCqn(expected)
    })
  })

  describe('shared prefix', () => {
    it('one association', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID, author.name, author.dateOfBirth }`)
      const expected = cds.ql`
				SELECT from bookshop.Books as Books
					left outer join bookshop.Authors as author on author.ID = Books.author_ID
				{
					Books.ID,
					author.name as author_name,
					author.dateOfBirth as author_dateOfBirth
				}`
      expect(transformed).to.equalCqn(expected)
    })

    it('drill into structure', () => {
      const transformed = cqn4sql(
        cds.ql`SELECT from bookshop.Books as Books { ID, author.name, author.address.street }`,
      )
      const expected = cds.ql`
				SELECT from bookshop.Books as Books
					left outer join bookshop.Authors as author on author.ID = Books.author_ID
				{
					Books.ID,
					author.name as author_name,
					author.address_street as author_address_street
				}`
      expect(transformed).to.equalCqn(expected)
    })

    it('drill into structure w/ explicit table alias', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as B { ID, author.name, B.author.address.street }`)
      const expected = cds.ql`
				SELECT from bookshop.Books as B
					left outer join bookshop.Authors as author on author.ID = B.author_ID
				{
					B.ID,
					author.name as author_name,
					author.address_street as author_address_street
				}`
      expect(transformed).to.equalCqn(expected)
    })

    it('different leaf association', () => {
      const transformed = cqn4sql(
        cds.ql`
					SELECT from bookshop.Authors as Authors
					{
						name,
						books.genre.descr,
						books.coAuthor.name,
						books.genre.code,
						books.coAuthor.dateOfBirth
					}`,
      )
      const expected = cds.ql`
				SELECT from bookshop.Authors as Authors
					left outer join bookshop.Books as books on books.author_ID = Authors.ID
					left outer join bookshop.Genres as genre on genre.ID = books.genre_ID
					left outer join bookshop.Authors as coAuthor on coAuthor.ID = books.coAuthor_ID
				{ Authors.name,
					genre.descr as books_genre_descr,
					coAuthor.name as books_coAuthor_name,
					genre.code as books_genre_code,
					coAuthor.dateOfBirth as books_coAuthor_dateOfBirth
				}`
      expect(transformed).to.equalCqn(expected)
    })
    it('same prefix in where', () => {
      const transformed = cqn4sql(
        cds.ql`SELECT from bookshop.Books as Books { ID, author.name } where author.placeOfBirth = 'Marbach'`,
      )
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
        {
          Books.ID,
          author.name as author_name
        }
        WHERE author.placeOfBirth = 'Marbach'`
      expect(transformed).to.equalCqn(expected)
    })
  })

  describe('recursive associations', () => {
    it('assign unique table aliases', () => {
      const transformed = cqn4sql(
        cds.ql`
					SELECT from bookshop.Books as Books
					{
						title,
						genre.descr,
						genre.parent.code,
						genre.parent.descr,
						genre.parent.parent.descr,
						genre.parent.parent.parent.descr,
					}`,
      )
      const expected = cds.ql`
				SELECT from bookshop.Books as Books
					left outer join bookshop.Genres as genre on genre.ID = Books.genre_ID
					left outer join bookshop.Genres as parent on parent.ID = genre.parent_ID
					left outer join bookshop.Genres as parent2 on parent2.ID = parent.parent_ID
					left outer join bookshop.Genres as parent3 on parent3.ID = parent2.parent_ID
				{
					Books.title,
					genre.descr as genre_descr,
					parent.code as genre_parent_code,
					parent.descr as genre_parent_descr,
					parent2.descr as genre_parent_parent_descr,
					parent3.descr as genre_parent_parent_parent_descr
				}`
      expect(transformed).to.equalCqn(expected)
    })

    it('explicit table alias shadows assoc', () => {
      const transformed = cqn4sql(
        cds.ql`SELECT from bookshop.Genres as parent {
						parent.parent.parent.descr
					}`,
      )

      const expected = cds.ql`
				SELECT from bookshop.Genres as parent
					left outer join bookshop.Genres as parent2 on parent2.ID = parent.parent_ID
					left outer join bookshop.Genres as parent3 on parent3.ID = parent2.parent_ID
				{
					parent3.descr as parent_parent_descr
				}`
      expect(transformed).to.equalCqn(expected)
    })
  })
})
