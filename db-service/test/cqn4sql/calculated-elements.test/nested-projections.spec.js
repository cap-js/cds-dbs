'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('Unfolding calculated elements - inline / expand / subquery', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql
    cqn4sql = (q, m) => orig(q, m ?? model)
  })

  it('in inline', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, author.{name, IBAN } }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID
      {
        Books.ID,
        author.firstName || ' ' || author.lastName as author_name,
        'DE' || author.checksum || author.sortCode  || author.accountNumber as author_IBAN
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('in inline back and forth', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, author.books.author.{name, IBAN } }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID
      left outer join booksCalc.Books as books2 on books2.author_ID = author.ID
      left outer join booksCalc.Authors as author2 on author2.ID = books2.author_ID
      {
        Books.ID,
        author2.firstName || ' ' || author2.lastName as author_books_author_name,
        'DE' || author2.checksum || author2.sortCode  || author2.accountNumber as author_books_author_IBAN
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('in subquery, using the same calc element - not join relevant in subquery', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books {
      ID,
      (
        SELECT from booksCalc.Authors as Authors {
          name,
          IBAN,
          addressText
        }
      ) as sub,
      author.books.author.{name, IBAN, addressText },
    }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID
      left outer join booksCalc.Books as books2 on books2.author_ID = author.ID
      left outer join booksCalc.Authors as author2 on author2.ID = books2.author_ID
      left outer join booksCalc.Addresses as address on address.ID = author2.address_ID
      {
        Books.ID,
        (
          SELECT from booksCalc.Authors as Authors
          left outer join booksCalc.Addresses as address2 on address2.ID = Authors.address_ID {
            Authors.firstName || ' ' || Authors.lastName as name,
            'DE' || Authors.checksum || Authors.sortCode  || Authors.accountNumber as IBAN,
            address2.street || ', ' || address2.city as addressText
          }
        ) as sub,
        author2.firstName || ' ' || author2.lastName as author_books_author_name,
        'DE' || author2.checksum || author2.sortCode  || author2.accountNumber as author_books_author_IBAN,
        address.street || ', ' || address.city as author_books_author_addressText
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('in inline, 2 assocs', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, author.{name, addressText } }`)
    // intermediate:
    // SELECT from booksCalc.Authors { ID, author.{firstName || ' ' || lastName, address.{street || ', ' || city}}}  }
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors   as author  on author.ID = Books.author_ID
      left outer join booksCalc.Addresses as address on address.ID = author.address_ID
      {
        Books.ID,
        author.firstName || ' ' || author.lastName as author_name,
        address.street || ', ' || address.city as author_addressText
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('in expand (to-one)', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, author {name, IBAN } }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books
      {
        Books.ID,
        (
          SELECT from booksCalc.Authors as $a {
            $a.firstName || ' ' || $a.lastName as name,
            'DE' || $a.checksum || $a.sortCode  || $a.accountNumber as IBAN
          } where Books.author_ID = $a.ID
        ) as author
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('in expand (to-one), 2 assocs', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, author {name, addressText } }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books
      {
        Books.ID,
        (
          SELECT from booksCalc.Authors as $a
          left join booksCalc.Addresses as address on address.ID = $a.address_ID
          {
            $a.firstName || ' ' || $a.lastName as name,
            address.street || ', ' || address.city as addressText
          } where Books.author_ID = $a.ID
        ) as author
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('expand and inline target same calc element', () => {
    const transformed = cqn4sql(
      cds.ql`SELECT from booksCalc.Books as Books { ID, author.{name, addressText }, author {name, addressText } }`,
    )
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books
          left outer join booksCalc.Authors   as author  on author.ID = Books.author_ID
          left outer join booksCalc.Addresses as address on address.ID = author.address_ID
      {
        Books.ID,
        author.firstName || ' ' || author.lastName as author_name,
        address.street || ', ' || address.city as author_addressText,
        (
          SELECT from booksCalc.Authors as $a
          left join booksCalc.Addresses as address2 on address2.ID = $a.address_ID
          {
            $a.firstName || ' ' || $a.lastName as name,
            address2.street || ', ' || address2.city as addressText
          } where Books.author_ID = $a.ID
        ) as author
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('expand and inline target same calc element inverted', () => {
    const transformed = cqn4sql(
      cds.ql`SELECT from booksCalc.Books as Books { ID, author {name, addressText }, author.{name, addressText } }`,
    )
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books
          left outer join booksCalc.Authors   as author  on author.ID = Books.author_ID
          left outer join booksCalc.Addresses as address on address.ID = author.address_ID
      {
        Books.ID,
        (
          SELECT from booksCalc.Authors as $a
          left join booksCalc.Addresses as address2 on address2.ID = $a.address_ID
          {
            $a.firstName || ' ' || $a.lastName as name,
            address2.street || ', ' || address2.city as addressText
          } where Books.author_ID = $a.ID
        ) as author,
        author.firstName || ' ' || author.lastName as author_name,
        address.street || ', ' || address.city as author_addressText
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('in expand (to-many)', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Authors { ID, books { ID, area, volume } }`)
    const expected = cds.ql`
      SELECT from booksCalc.Authors as $A {
        $A.ID,
        (
          SELECT from booksCalc.Books as $b
          {
            $b.ID,
            $b.length * $b.width as area,
            ($b.length * $b.width) * $b.height as volume,
          } where $A.ID = $b.author_ID
        ) as books
      }`
    expectCqn(transformed).to.equal(expected)
  })
})
