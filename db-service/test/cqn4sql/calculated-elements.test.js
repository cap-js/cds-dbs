'use strict'

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds/lib')
const { expect } = cds.test

describe.skip('Unfolding calculated elements in select list', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/model/booksWithExpr').then(cds.linked)
  })

  it('directly', () => {
    let query = cqn4sql(CQL`SELECT from booksCalc.Books { ID, area }`, model)
    const expected = CQL`SELECT from booksCalc.Books as Books {
        Books.ID,
        Books.length * Books.width as area
      }`
    expect(query).to.deep.equal(expected)
  })

  // CDL style cast ?

  it('in expression', () => {
    let query = cqn4sql(CQL`SELECT from booksCalc.Books { ID, stock * area as f }`, model)
    const expected = CQL`SELECT from booksCalc.Books as Books {
        Books.ID,
        Books.stock * ( Books.length * Books.width ) as f
      }`
    expect(query).to.deep.equal(expected)
  })

  it('in function', () => {
    let query = cqn4sql(CQL`SELECT from booksCalc.Books { ID, round(area, 2) as f }`, model)
    const expected = CQL`SELECT from booksCalc.Books as Books {
        Books.ID,
        round(Books.length * Books.width,2 ) as f
      }`
    expect(query).to.deep.equal(expected)
  })

  it('calc elem is function', () => {
    let query = cqn4sql(CQL`SELECT from booksCalc.Books { ID, ctitle }`, model)
    const expected = CQL`SELECT from booksCalc.Books as Books {
        Books.ID,
        substring(Books.title, 3, Books.stock) as ctitle;
      }`
    expect(query).to.deep.equal(expected)
  })

  it('nested', () => {
    let query = cqn4sql(CQL`SELECT from booksCalc.Books { ID, volume, storageVolume }`, model)
    const expected = CQL`SELECT from booksCalc.Books as Books {
        Books.ID,
        (length * width) * height as volume,
        stock * ((length * width) * height) as storageVolume
      }`
    expect(query).to.deep.equal(expected)
  })

  it('via association', () => {
    let query = cqn4sql(CQL`SELECT from booksCalc.Books { ID, author.name }`, model)
    const expected = CQL`SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID
      {
        Books.ID,
        author.firstName || ' ' || author.lastName as name;
      }`
    expect(query).to.deep.equal(expected)
  })

  it('calc elem contains association', () => {
    let query = cqn4sql(CQL`SELECT from booksCalc.Books { ID, authorName, authorLastName }`, model)
    // intermediate:
    // SELECT from booksCalc.Books { ID, author.name, author.lastName }
    const expected = CQL`SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID
      {
        Books.ID,
        author.firstName || ' ' || author.lastName as authorName,
        author.lastName as authorLastName
        
      }`
    expect(query).to.deep.equal(expected)
  })

  it('calc elem contains association, nested', () => {
    let query = cqn4sql(CQL`SELECT from booksCalc.Books { ID, authorAdrText }`, model)
    // intermediate:
    // SELECT from booksCalc.Books { ID, author.address.text }
    const expected = CQL`SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID
      left outer join booksCalc.Addresses as address on address.ID = author.address_ID
      {
        Books.ID,
        address.street || ', ' || address.city as authorAdrText
      }`
    expect(query).to.deep.equal(expected)
  })

  it('calc elem in infix filter', () => {
    let query = cqn4sql(CQL`SELECT from booksCalc.Authors { ID, books[area > 1].title }`, model)
    // intermediate:
    // SELECT from booksCalc.Authors { ID, books[(length * width) > 1].title }
    const expected = CQL`SELECT from booksCalc.Authors as Authors
      left outer join booksCalc.Boods as books on ( books.author_ID = author.ID )
        AND ( ( books.length * books.width ) > 1 )
      {
        Authors.ID,
        books.title
      }`
    expect(query).to.deep.equal(expected)
  })
})
