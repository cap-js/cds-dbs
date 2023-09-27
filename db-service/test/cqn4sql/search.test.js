'use strict'
const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds/lib')
const { expect } = cds.test

describe('Replace attribute search by search predicate', () => {
  describe('basic search', () => {
    let model
    beforeAll(async () => {
      model = cds.model = cds.compile.for.nodejs(await cds.load(`${__dirname}/../bookshop/db/schema`).then(cds.linked))
    })
    it('one string element with one search element', () => {
      // WithStructuredKey is the only entity with only one string element in the model ...
      let query = CQL`SELECT from bookshop.WithStructuredKey as wsk { second }`
      query.SELECT.search = [{ val: 'x' }]

      let res = cqn4sql(query, model)
      // single val is stored as val directly, not as expr with val
      const expected = CQL`SELECT from bookshop.WithStructuredKey as wsk {
      wsk.second
    } where search(wsk.second, 'x')`
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(expected)
    })

    it('one string element', () => {
      // WithStructuredKey is the only entity with only one string element in the model ...
      let query = CQL`SELECT from bookshop.WithStructuredKey as wsk { second }`
      query.SELECT.search = [{ val: 'x' }, 'or', { val: 'y' }]

      let res = cqn4sql(query, model)
      const expected = CQL`SELECT from bookshop.WithStructuredKey as wsk {
      wsk.second
    } where search(wsk.second, ('x' OR 'y'))`
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(expected)
    })

    it('multiple string elements', () => {
      let query = CQL`SELECT from bookshop.Genres { ID }`
      query.SELECT.search = [{ val: 'x' }, 'or', { val: 'y' }]

      let res = cqn4sql(query, model)
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(CQL`SELECT from bookshop.Genres as Genres {
      Genres.ID
    } where search((Genres.name, Genres.descr, Genres.code), ('x' OR 'y'))`)
    })

    it('with existing WHERE clause', () => {
      let query = CQL`SELECT from bookshop.Genres { ID } where ID < 4 or ID > 5`
      query.SELECT.search = [{ val: 'x' }, 'or', { val: 'y' }]

      let res = cqn4sql(query, model)
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(CQL`SELECT from bookshop.Genres as Genres {
      Genres.ID
    } where (Genres.ID < 4 or Genres.ID > 5)
        and search((Genres.name, Genres.descr, Genres.code), ('x' OR 'y'))`)
    })

    it('with filter on data source', () => {
      let query = CQL`SELECT from bookshop.Genres[ID < 4 or ID > 5] { ID }`
      query.SELECT.search = [{ val: 'x' }, 'or', { val: 'y' }]

      let res = cqn4sql(query, model)
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(CQL`SELECT from bookshop.Genres as Genres {
      Genres.ID
    } where (Genres.ID < 4 or Genres.ID > 5)
        and search((Genres.name, Genres.descr, Genres.code), ('x' OR 'y'))`)
    })

    it('string fields inside struct', () => {
      let query = CQL`SELECT from bookshop.Person { ID }`
      query.SELECT.search = [{ val: 'x' }, 'or', { val: 'y' }]

      let res = cqn4sql(query, model)
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(CQL`SELECT from bookshop.Person as Person {
      Person.ID
    } where search((Person.name, Person.placeOfBirth, Person.placeOfDeath, Person.address_street, Person.address_city), ('x' OR 'y'))`)
    })

    it('ignores virtual string elements', () => {
      let query = CQL`SELECT from bookshop.Foo { ID }`
      query.SELECT.search = [{ val: 'x' }, 'or', { val: 'y' }]

      let res = cqn4sql(query, model)
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(CQL`SELECT from bookshop.Foo as Foo {
      Foo.ID
    }`)
    })
    it('Uses primary query source in case of joins', () => {
      let query = CQL`SELECT from bookshop.Books { ID, author.books.title as authorsBook }`
      query.SELECT.search = [{ val: 'x' }, 'or', { val: 'y' }]

      let res = cqn4sql(query, model)
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(
        CQL`
      SELECT from bookshop.Books as Books
        left join bookshop.Authors as author on author.ID = Books.author_ID
        left join bookshop.Books as books2 on books2.author_ID = author.ID
      {
        Books.ID,
        books2.title as authorsBook
      } where search((Books.createdBy, Books.modifiedBy, Books.anotherText, Books.title, Books.descr, Books.currency_code, Books.dedication_text, Books.dedication_sub_foo, Books.dedication_dedication), ('x' OR 'y')) `,
      )
    })
    it('Search on navigation', () => {
      let query = CQL`SELECT from bookshop.Authors:books { ID }`
      query.SELECT.search = [{ val: 'x' }, 'or', { val: 'y' }]

      let res = cqn4sql(query, model)
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(
        CQL`
      SELECT from bookshop.Books as books
      {
        books.ID,
      } where (
        exists (
          SELECT 1 from bookshop.Authors as Authors
          where Authors.ID = books.author_ID
        )
      )
      and
        search((books.createdBy, books.modifiedBy, books.anotherText, books.title, books.descr, books.currency_code, books.dedication_text, books.dedication_sub_foo, books.dedication_dedication), ('x' OR 'y'))`,
      )
    })
  })

  describe('search w/ path expressions', () => {
    let model
    beforeAll(async () => {
      model = cds.model = cds.compile.for.nodejs(await cds.load(`${__dirname}/../bookshop/db/search`).then(cds.linked))
    })

    it('one string element with one search element', () => {
      let query = CQL`SELECT from search.BooksSeachAuthorName { ID, title }`
      query.SELECT.search = [{ val: 'x' }]

      let res = cqn4sql(query, model)
      const expected = CQL`
      SELECT from search.BooksSeachAuthorName as BooksSeachAuthorName left join search.Authors as author on author.ID = BooksSeachAuthorName.author_ID
      {
        BooksSeachAuthorName.ID,
        BooksSeachAuthorName.title
    } where search(author.lastName, 'x')`
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(expected)
    })

    it('search all searchable fields in target', () => {
      let query = CQL`SELECT from search.BooksSeachAuthor as Books { ID, title }`
      query.SELECT.search = [{ val: 'x' }]

      let res = cqn4sql(query, model)
      const expected = CQL`
      SELECT from search.BooksSeachAuthor as Books left join search.Authors as author on author.ID = Books.author_ID
      {
        Books.ID,
        Books.title
    } where search((author.lastName, author.firstName), 'x')`
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(expected)
    })

    it('search only some searchable fields via multiple association paths', () => {
      let query = CQL`SELECT from search.BooksSeachAuthorAndAddress as Books { ID, title }`
      query.SELECT.search = [{ val: 'x' }]

      let res = cqn4sql(query, model)
      const expected = CQL`
      SELECT from search.BooksSeachAuthorAndAddress as Books
        left join search.AuthorsSearchAddresses as authorWithAddress on authorWithAddress.ID = Books.authorWithAddress_ID
        left join search.Addresses as address on address.ID = authorWithAddress.address_ID
      {
        Books.ID,
        Books.title
    } where search((authorWithAddress.note, address.city), 'x')`
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(expected)
    })

    it('search calculated element via path expression', () => {
      let query = CQL`SELECT from search.AuthorsSearchCalculatedAddress as Authors { lastName }`
      query.SELECT.search = [{ val: 'x' }]

      let res = cqn4sql(query, model)
      const expected = CQL`
      SELECT from search.AuthorsSearchCalculatedAddress as Authors
          left join search.CalculatedAddresses as address on address.ID = Authors.address_ID
      {
        Authors.lastName
    } where search((Authors.note, (address.street || ' ' || address.zip || '' || address.city)), 'x')`
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(expected)
    })
  })
})
