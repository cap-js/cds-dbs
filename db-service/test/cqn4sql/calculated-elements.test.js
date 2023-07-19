'use strict'

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds/lib')
const { expect } = cds.test

describe('Unfolding calculated elements in select list', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/model/booksWithExpr').then(cds.linked)
  })

  // todo: check inferred -> type should survive
  it('directly', () => {
    let query = cqn4sql(CQL`SELECT from booksCalc.Books { ID, stock2 }`, model)
    const expected = CQL`SELECT from booksCalc.Books as Books {
        Books.ID,
        Books.stock as stock2
      }`
    expect(query).to.deep.equal(expected)
  })

  it('simple val', () => {
    let query = cqn4sql(CQL`SELECT from booksCalc.Authors { ID, IBAN }`, model)
    const expected = CQL`SELECT from booksCalc.Authors as Authors {
        Authors.ID,
        'DE' || Authors.checksum || Authors.sortCode || Authors.accountNumber as IBAN
      }`
    expect(query).to.deep.equal(expected)
  })

  // todo: check inferred -> type should be there
  it('directly', () => {
    let query = cqn4sql(CQL`SELECT from booksCalc.Books { ID, area }`, model)
    const expected = CQL`SELECT from booksCalc.Books as Books {
        Books.ID,
        Books.length * Books.width as area
      }`
    expect(query).to.deep.equal(expected)
  })

  // test with ce that has no type (for inferred)?

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
        round(Books.length * Books.width, 2) as f
      }`
    expect(query).to.deep.equal(expected)
  })

  it('calc elem is function', () => {
    let query = cqn4sql(CQL`SELECT from booksCalc.Books { ID, ctitle }`, model)
    const expected = CQL`SELECT from booksCalc.Books as Books {
        Books.ID,
        substring(Books.title, 3, Books.stock) as ctitle
      }`
    expect(query).to.deep.equal(expected)
  })

  it('calc elem is function, nested in direct expression', () => {
    let query = cqn4sql(CQL`SELECT from booksCalc.Books { ID, ctitle || title as f }`, model)
    const expected = CQL`SELECT from booksCalc.Books as Books {
        Books.ID,
        substring(Books.title, 3, Books.stock) || Books.title as f
      }`
    expect(query).to.deep.equal(expected)
  })

  it('nested calc elems', () => {
    let query = cqn4sql(CQL`SELECT from booksCalc.Books { ID, volume, storageVolume }`, model)
    const expected = CQL`SELECT from booksCalc.Books as Books {
        Books.ID,
        (Books.length * Books.width) * Books.height as volume,
        Books.stock * ((Books.length * Books.width) * Books.height) as storageVolume
      }`
    expect(query).to.deep.equal(expected)
  })

  it('nested calc elems, nested in direct expression', () => {
    let query = cqn4sql(CQL`SELECT from booksCalc.Books { ID, storageVolume / volume as f }`, model)
    const expected = CQL`SELECT from booksCalc.Books as Books {
        Books.ID,
        (Books.stock * ((Books.length * Books.width) * Books.height))
          / ((Books.length * Books.width) * Books.height) as f
      }`
    expect(query).to.deep.equal(expected)
  })

  //
  // with associations
  //

  it('via an association path', () => {
    let query = cqn4sql(CQL`SELECT from booksCalc.Books { ID, author.name }`, model)
    // revisit: alias follows our "regular" naming scheme -> ref.join('_')
    const expected = CQL`SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID {
        Books.ID,
        author.firstName || ' ' || author.lastName as author_name
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
  it('calc elem contains associations in xpr', () => {
    let query = cqn4sql(CQL`SELECT from booksCalc.Books { ID, authorFullName }`, model)
    // intermediate:
    // SELECT from booksCalc.Books { ID, author.name, author.lastName }
    const expected = CQL`SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID
      {
        Books.ID,
        author.firstName || ' ' || author.lastName as authorFullName,
      }`
    expect(query).to.deep.equal(expected)
  })
  it('calc elem contains other calculated element in xpr with nested joins', () => {
    let query = cqn4sql(CQL`SELECT from booksCalc.Books { ID, authorFullNameWithAddress }`, model)
    // intermediate:
    // SELECT from booksCalc.Books { ID, author.name, author.lastName }
    const expected = CQL`SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID
      left outer join booksCalc.Addresses as address on address.ID = author.address_ID
      {
        Books.ID,
        (author.firstName || ' ' || author.lastName) || ' ' || (address.street || ', ' || address.city)
         as authorFullNameWithAddress,
      }`
    expect(query).to.deep.equal(expected)
  })

  it('calc elem contains association, nested', () => {
    let query = cqn4sql(CQL`SELECT from booksCalc.Books { ID, authorAdrText }`, model)
    // intermediate:
    // SELECT from booksCalc.Books { ID, author.address.{street || ', ' || city} }
    const expected = CQL`SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID
      left outer join booksCalc.Addresses as address on address.ID = author.address_ID
      {
        Books.ID,
        address.street || ', ' || address.city as authorAdrText
      }`
    expect(query).to.deep.equal(expected)
  })

  it('calc elem contains association with filter', () => {
    let query = cqn4sql(CQL`SELECT from booksCalc.Authors { ID, addressTextFilter }`, model)
    // intermediate:
    // SELECT from booksCalc.Authors { ID, address[number * 2 > 17].{street || ', ' || city}  }
    const expected = CQL`SELECT from booksCalc.Authors as Authors
      left outer join booksCalc.Addresses as address on address.ID = Authors.address_ID
                                                     and (address.number * 2) > 17
      {
        Authors.ID,
        address.street || ', ' || address.city as addressTextFilter
      }`
    expect(query).to.deep.equal(expected)
  })
})

describe('Unfolding calculated elements in other places', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/model/booksWithExpr').then(cds.linked)
  })

  it('in where', () => {
    let query = cqn4sql(CQL`SELECT from booksCalc.Books { ID } where area < 13`, model)
    const expected = CQL`SELECT from booksCalc.Books as Books { Books.ID }
      where (Books.length * Books.width) < 13
    `
    expect(query).to.deep.equal(expected)
  })

  it('in group by & having', () => {
    let query = cqn4sql(
      CQL`SELECT from booksCalc.Books { ID, sum(price) as tprice }
      group by ctitle having ctitle like 'A%'`,
      model,
    )
    const expected = CQL`SELECT from booksCalc.Books as Books {
        Books.ID, sum(Books.price) as tprice
      } group by substring(Books.title, 3, Books.stock)
        having substring(Books.title, 3, Books.stock) like 'A%'
    `
    expect(query).to.deep.equal(expected)
  })

  it('in order by', () => {
    let query = cqn4sql(CQL`SELECT from booksCalc.Books { ID, title } order by ctitle`, model)
    const expected = CQL`SELECT from booksCalc.Books as Books {
        Books.ID, Books.title
      } order by substring(Books.title, 3, Books.stock)
    `
    expect(query).to.deep.equal(expected)
  })

  it('in filter in path in FROM', () => {
    let query = cqn4sql(CQL`SELECT from booksCalc.Authors[name like 'A%'].books[storageVolume < 4] { ID }`, model)
    const expected = CQL`SELECT from booksCalc.Books as books {
      books.ID
    } where exists (select 1 from booksCalc.Authors as Authors 
                      where Authors.ID = books.author_ID
                        and (Authors.firstName || ' ' || Authors.lastName) like 'A%')
                        and (books.stock * ((books.length * books.width) * books.height)) < 4
    `
    expect(query).to.deep.equal(expected)
  })
})

// ? calc elem at several places in one query (select, where, order ...) ?

describe('Unfolding calculated elements ... misc', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/model/booksWithExpr').then(cds.linked)
  })
  // Calculated elements on-write are not supported, yet (in entity:“booksCalc.Books”/element:“areaS”)
  it.skip('calculated element on-write (stored) is not unfolded', () => {
    let query = cqn4sql(CQL`SELECT from booksCalc.Books { ID, areaS }`, model)
    const expected = CQL`SELECT from booksCalc.Books as Books { Books.ID, Books.areaS }`
    expect(query).to.deep.equal(expected)
  })
})

describe('Unfolding calculated elements and localized', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/model/booksWithExpr').then(cds.linked)
    model = cds.compile.for.nodejs(model)
  })

  it('presence of localized element should not affect unfolding', () => {
    const q = CQL`SELECT from booksCalc.LBooks { ID, title, area }`
    q.SELECT.localized = true
    let query = cqn4sql(q, model)
    const expected = CQL`SELECT from localized.booksCalc.LBooks as LBooks {
        LBooks.ID,
        LBooks.title,
        LBooks.length * LBooks.width as area
      }`
    expected.SELECT.localized = true
    expect(query).to.deep.equal(expected)
  })

  it.skip('calculated element refers to localized element', () => {
    const q = CQL`SELECT from booksCalc.LBooks { ID, title, ctitle }`
    q.SELECT.localized = true
    let query = cqn4sql(q, model)
    const expected = CQL`SELECT from localized.booksCalc.LBooks as LBooks {
        LBooks.ID,
        LBooks.title,
        substring(LBooks.title, 3, 3) as ctitle
      }`
    expected.SELECT.localized = true
    expect(query).to.deep.equal(expected)
  })
})
