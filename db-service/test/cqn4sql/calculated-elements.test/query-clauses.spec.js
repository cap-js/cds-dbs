'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('Unfolding calculated elements - query clauses (where, from, group by, having, order by, subquery)', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql
    cqn4sql = (q, m) => orig(q, m ?? model)
  })

  it('in where', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID } where area < 13`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books { Books.ID }
      where (Books.length * Books.width) < 13
    `
    expectCqn(transformed).to.equal(expected)
  })

  it('in the from clause', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books[area < 13] as Books { ID }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books { Books.ID }
      where (Books.length * Books.width) < 13
    `
    expectCqn(transformed).to.equal(expected)
  })

  it('in the from clause with a function', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Authors[age > 30] as Oldies { ID }`)
    const expected = cds.ql`
      SELECT from booksCalc.Authors as Oldies { Oldies.ID }
      where years_between( Oldies.dateOfBirth, Oldies.dateOfDeath ) > 30
    `
    expectCqn(transformed).to.equal(expected)
  })

  it('in the from clause with a function in a scoped query', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Authors[age > 30]:books as BooksOfOldies { ID }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as BooksOfOldies { BooksOfOldies.ID }
      where exists (
        select 1 from booksCalc.Authors as $A
        where $A.ID = BooksOfOldies.author_ID
          and years_between( $A.dateOfBirth, $A.dateOfDeath ) > 30
      )
    `
    expectCqn(transformed).to.equal(expected)
  })

  it('in the from clause with a function in a scoped query, within another expression', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Authors[anotherFunc(age * (7+5)) + 42 > 'foo']:books as BooksOfOldies { ID }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as BooksOfOldies { BooksOfOldies.ID }
      where exists (
        select 1 from booksCalc.Authors as $A
        where $A.ID = BooksOfOldies.author_ID
          and anotherFunc( years_between( $A.dateOfBirth, $A.dateOfDeath ) * (7 + 5) ) + 42 > 'foo'
      )
    `
    expectCqn(transformed).to.equal(expected)
  })

  it.skip('in the from clause with a join relevant path', () => {
    // TODO: infix filter at from leaf is only a regular where,
    // we must not reject the join relevant path with:
    // Error: Only foreign keys of “author” can be accessed in infix filter, but found “firstName”
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books[authorFullName = 'Brandon Sanderson'] as Books { ID }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books
        left join booksCalc.Authors as author on author.ID = Books.author_ID
      { Books.ID }
      where (author.firstName || ' ' || author.lastName) = 'Brandon Sanderson'
    `
    expectCqn(transformed).to.equal(expected)
  })

  it('in group by & having', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, sum(price) as tprice }
      group by ctitle having ctitle like 'A%'`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books {
        Books.ID, sum(Books.price) as tprice
      } group by substring(Books.title, 3, Books.stock)
        having substring(Books.title, 3, Books.stock) like 'A%'
    `
    expectCqn(transformed).to.equal(expected)
  })

  it('in order by', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, title } order by ctitle`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books {
        Books.ID, Books.title
      } order by substring(Books.title, 3, Books.stock)
    `
    expectCqn(transformed).to.equal(expected)
  })

  it('in a subquery', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books {
      ID,
      (select from booksCalc.Authors as A { name }
         where A.ID = Books.author.ID and A.IBAN = Books.area + Books.ctitle) as f
    }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books {
        Books.ID,
        (select from booksCalc.Authors as A { A.firstName || ' ' || A.lastName as name }
            where A.ID = Books.author_ID
            and ('DE' || A.checksum || A.sortCode  || A.accountNumber)
                 = (Books.length * Books.width) + substring(Books.title, 3, Books.stock)
        ) as f
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('in a subquery calc element is join relevant', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books {
      ID,
      (select from booksCalc.Authors as A { books.title }
         where A.ID = Books.author.ID and A.IBAN = Books.area + Books.ctitle) as f
    }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books {
        Books.ID,
        (select from booksCalc.Authors as A
          left join booksCalc.Books as books2 on books2.author_ID = A.ID
          { books2.title as books_title }
            where A.ID = Books.author_ID
            and ('DE' || A.checksum || A.sortCode  || A.accountNumber)
                 = (Books.length * Books.width) + substring(Books.title, 3, Books.stock)
        ) as f
      }`
    expectCqn(transformed).to.equal(expected)
  })
})
