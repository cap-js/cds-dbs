'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('Unfolding calculated elements - filters', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql
    cqn4sql = (q, m) => orig(q, m ?? model)
  })

  it('in filter', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Authors as Authors { ID, books[area >17].title }`)
    // intermediate:
    // SELECT from booksCalc.Authors { ID, books[(length * width) > 1].title }
    const expected = cds.ql`
      SELECT from booksCalc.Authors as Authors
      left outer join booksCalc.Books as books on  books.author_ID  = Authors.ID
                                               and (books.length * books.width) > 17
      {
        Authors.ID,
        books.title as books_title
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('calc elem contains association with filter', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Authors as Authors { ID, addressTextFilter }`)
    // intermediate:
    // SELECT from booksCalc.Authors { ID, address[number * 2 > 17].{street || ', ' || city}  }
    const expected = cds.ql`
      SELECT from booksCalc.Authors as Authors
      left outer join booksCalc.Addresses as address on address.ID = Authors.address_ID
                                                     and (address.number * 2) > 17
      {
        Authors.ID,
        address.street || ', ' || address.city as addressTextFilter
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('calculated element has other calc element in infix filter', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books {
      ID,
      youngAuthorName
    }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books
        left join booksCalc.Authors as author on author.ID = Books.author_ID
                  and years_between(author.dateOfBirth, author.dateOfDeath) < 50
      {
        Books.ID,
        author.firstName || ' ' || author.lastName as youngAuthorName
      }
    `
    expectCqn(transformed).to.equal(expected)
  })

  it('in filter in path in FROM', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Authors[name like 'A%'].books[storageVolume < 4] { ID }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as $b {
        $b.ID
      } where exists (select 1 from booksCalc.Authors as $A
                        where $A.ID = $b.author_ID
                          and ($A.firstName || ' ' || $A.lastName) like 'A%')
                          and ($b.stock * (($b.length * $b.width) * $b.height)) < 4
    `
    expectCqn(transformed).to.equal(expected)
  })

  it('in filter in where exists', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Authors { ID } where exists books[area < 13]`)
    const expected = cds.ql`
      SELECT from booksCalc.Authors as $A { $A.ID }
      where exists (
        select 1 from booksCalc.Books as $b where $b.author_ID = $A.ID
          and ($b.length * $b.width) < 13
      )
    `
    expectCqn(transformed).to.equal(expected)
  })
})
