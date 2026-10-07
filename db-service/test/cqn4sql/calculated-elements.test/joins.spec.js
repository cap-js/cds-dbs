'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('Unfolding calculated elements - joins', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql
    cqn4sql = (q, m) => orig(q, m ?? model)
  })

  it('via an association path', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, author.name }`)
    // revisit: alias follows our "regular" naming scheme -> ref.join('_')
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID {
        Books.ID,
        author.firstName || ' ' || author.lastName as author_name
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('via an association in columns and where', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, author.name } where author.name like '%Bro%'`)
    // revisit: alias follows our "regular" naming scheme -> ref.join('_')
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID {
        Books.ID,
        author.firstName || ' ' || author.lastName as author_name
      } where (author.firstName || ' ' || author.lastName) like '%Bro%'`
    expectCqn(transformed).to.equal(expected)
  })

  it('via an association path, nested in direct expression', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, substring(author.name, 2, stock) as f }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID {
        Books.ID,
        substring(author.firstName || ' ' || author.lastName, 2, Books.stock) as f
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('via two association paths', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Authors as Authors { ID, books[stock<5].area, books[stock>5].area as a2}`)
    const expected = cds.ql`
      SELECT from booksCalc.Authors as Authors
      left outer join booksCalc.Books as books  on books.author_ID  = Authors.ID and books.stock  < 5
      left outer join booksCalc.Books as books2 on books2.author_ID = Authors.ID and books2.stock > 5
      {
        Authors.ID,
        books.length * books.width   as books_area,
        books2.length * books2.width as a2
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('calc elem contains association', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, authorName, authorLastName }`)
    // intermediate:
    // SELECT from booksCalc.Books { ID, author.name, author.lastName }
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID
      {
        Books.ID,
        author.firstName || ' ' || author.lastName as authorName,
        author.lastName as authorLastName
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('calc elem contains associations in xpr', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, authorFullName }`)
    // intermediate:
    // SELECT from booksCalc.Books { ID, author.name, author.lastName }
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID
      {
        Books.ID,
        author.firstName || ' ' || author.lastName as authorFullName,
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('calc elem contains association, nested', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, authorAdrText }`)
    // intermediate:
    // SELECT from booksCalc.Books { ID, author.address.{street || ', ' || city} }
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID
      left outer join booksCalc.Addresses as address on address.ID = author.address_ID
      {
        Books.ID,
        address.street || ', ' || address.city as authorAdrText
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('in a function, args are join relevant', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books {
      ID,
      authorAge
    }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books
        left join booksCalc.Authors as author on author.ID = Books.author_ID
      {
        Books.ID,
        years_between( author.sortCode, author.sortCode ) as authorAge
      }
    `
    expectCqn(transformed).to.equal(expected)
  })

  describe('join node reuse', () => {
    it('calculated elements are join relevant and share same join node', () => {
      // make sure that if a join was already calculated,
      // calc elements which can use the same join have
      // their table aliases properly rewritten to the already
      // existing join node
      const transformed = cqn4sql(cds.ql`
        SELECT from booksCalc.Books as Books {
          youngAuthorName,
          authorLastName,
          authorName,
          authorFullName,
          authorAge
        }
      `)
      const expected = cds.ql`
        SELECT from booksCalc.Books as Books
        left outer join booksCalc.Authors as author on author.ID = Books.author_ID
                        and years_between(author.dateOfBirth, author.dateOfDeath) < 50
        left outer join booksCalc.Authors as author2 on author2.ID = Books.author_ID
        {
          author.firstName || ' ' || author.lastName as youngAuthorName,
          author2.lastName as authorLastName,
          author2.firstName || ' ' || author2.lastName as authorName,
          author2.firstName || ' ' || author2.lastName as authorFullName,
          years_between( author2.sortCode, author2.sortCode ) as authorAge
        }`
      expectCqn(transformed).to.equal(expected)
    })

    it('calculated elements are join relevant and share same join node indirect', () => {
      // make sure that if a join was already calculated,
      // calc elements which can use the same join have
      // their table aliases properly rewritten to the already
      // existing join node
      const transformed = cqn4sql(cds.ql`
        SELECT from booksCalc.Authors as Authors {
          books.youngAuthorName,
          books.authorLastName,
          books.authorName,
          books.authorFullName,
          books.authorAge
        } where books.youngAuthorName = 'King'
      `)
      const expected = cds.ql`
        SELECT from booksCalc.Authors as Authors
        left outer join booksCalc.Books as books on books.author_ID = Authors.ID
        left outer join booksCalc.Authors as author on author.ID = books.author_ID
                        and years_between(author.dateOfBirth, author.dateOfDeath) < 50
        left outer join booksCalc.Authors as author2 on author2.ID = books.author_ID
        {
          author.firstName || ' ' || author.lastName as books_youngAuthorName,
          author2.lastName as books_authorLastName,
          author2.firstName || ' ' || author2.lastName as books_authorName,
          author2.firstName || ' ' || author2.lastName as books_authorFullName,
          years_between( author2.sortCode, author2.sortCode ) as books_authorAge
        } where (author.firstName || ' ' || author.lastName) = 'King'`
      expectCqn(transformed).to.equal(expected)
    })

    it('calculated elements are join relevant and share same join node indirect back and forth', () => {
      // make sure that if a join was already calculated,
      // calc elements which can use the same join have
      // their table aliases properly rewritten to the already
      // existing join node
      const transformed = cqn4sql(cds.ql`
        SELECT from booksCalc.Authors as Authors {
          books.author.books.youngAuthorName,
          books.author.books.authorLastName,
          books.author.books.authorName,
          books.author.books.authorFullName,
          books.author.books.authorAge
        } where books.author.books.youngAuthorName = 'King'
      `)
      const expected = cds.ql`
        SELECT from booksCalc.Authors as Authors
        left outer join booksCalc.Books as books on books.author_ID = Authors.ID
        left outer join booksCalc.Authors as author on author.ID = books.author_ID
        left outer join booksCalc.Books as books2 on books2.author_ID = author.ID
        left outer join booksCalc.Authors as author2 on author2.ID = books2.author_ID
          and years_between(author2.dateOfBirth, author2.dateOfDeath) < 50
        left outer join booksCalc.Authors as author3 on author3.ID = books2.author_ID
        {
          author2.firstName || ' ' || author2.lastName as books_author_books_youngAuthorName,
          author3.lastName as books_author_books_authorLastName,
          author3.firstName || ' ' || author3.lastName as books_author_books_authorName,
          author3.firstName || ' ' || author3.lastName as books_author_books_authorFullName,
          years_between( author3.sortCode, author3.sortCode ) as books_author_books_authorAge
        } where (author2.firstName || ' ' || author2.lastName) = 'King'`
      expectCqn(transformed).to.equal(expected)
    })
  })
})
