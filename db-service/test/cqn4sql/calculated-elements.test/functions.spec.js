'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('Unfolding calculated elements - functions', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql
    cqn4sql = (q, m) => orig(q, m ?? model)
  })

  it('in function with named param', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Authors as Authors { ID, ageNamedParams as f }`)
    const expected = cds.ql`
      SELECT from booksCalc.Authors as Authors {
        Authors.ID,
        years_between(DOB => Authors.dateOfBirth, DOD => Authors.dateOfDeath) as f
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('calc elem is function', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, ctitle }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books {
        Books.ID,
        substring(Books.title, 3, Books.stock) as ctitle
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('calc elem is xpr with multiple functions as args', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, authorAgeNativePG }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books
      left join booksCalc.Authors as author on author.ID = Books.author_ID
      {
        Books.ID,
        DATE_PART('year', author.dateOfDeath) - DATE_PART('year', author.dateOfBirth) as authorAgeNativePG
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('calc elem is xpr with nested xpr which has multiple functions as args', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, authorAgeInDogYears }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books
      left join booksCalc.Authors as author on author.ID = Books.author_ID
      {
        Books.ID,
        ( DATE_PART('year', author.dateOfDeath) - DATE_PART('year', author.dateOfBirth) ) * 7 as authorAgeInDogYears
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('calc elem is xpr with multiple functions as args - back and forth', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, author.books.authorAgeNativePG }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books
      left join booksCalc.Authors as author on author.ID = Books.author_ID
      left join booksCalc.Books as books2 on books2.author_ID = author.ID
      left join booksCalc.Authors as author2 on author2.ID = books2.author_ID
      {
        Books.ID,
        DATE_PART('year', author2.dateOfDeath) - DATE_PART('year', author2.dateOfBirth) as author_books_authorAgeNativePG
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('calc elem is function, nested in direct expression', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, ctitle || title as f }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books {
        Books.ID,
        substring(Books.title, 3, Books.stock) || Books.title as f
      }`
    expectCqn(transformed).to.equal(expected)
  })
})
