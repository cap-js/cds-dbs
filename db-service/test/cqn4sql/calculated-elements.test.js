'use strict'

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds')
const { expect } = cds.test

describe('Unfolding calculated elements in select list', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/booksWithExpr').then(cds.linked)
  })

  it('simple reference', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, stock2 }`, model)
    const expected = cds.ql`SELECT from booksCalc.Books as Books {
        Books.ID,
        Books.stock as stock2
      }`
    expect(query).to.deep.equal(expected)
  })

  it('simple val', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Authors as Authors { ID, IBAN }`, model)
    const expected = cds.ql`SELECT from booksCalc.Authors as Authors {
        Authors.ID,
        'DE' || Authors.checksum || Authors.sortCode || Authors.accountNumber as IBAN
      }`
    expect(query).to.deep.equal(expected)
  })

  it('directly', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, area }`, model)
    const expected = cds.ql`SELECT from booksCalc.Books as Books {
        Books.ID,
        Books.length * Books.width as area
      }`
    expect(query).to.deep.equal(expected)
  })

  it('in expression', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, stock * area as f }`, model)
    const expected = cds.ql`SELECT from booksCalc.Books as Books {
        Books.ID,
        Books.stock * ( Books.length * Books.width ) as f
      }`
    expect(query).to.deep.equal(expected)
  })

  it('in ternary', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Ternary as Ternary { ID, nestedTernary }`, model)
    const expected = cds.ql`SELECT from booksCalc.Ternary as Ternary
      left join booksCalc.Books as book on book.ID = Ternary.book_ID
      {
        Ternary.ID,
        (case when 1 > 0 then 1 else (case when book.stock > 10 then Ternary.value else 3 end) end) as nestedTernary
      }`
    expect(query).to.deep.equal(expected)
  })

  it('calcualted element in nested ternary', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Ternary as Ternary { ID, calculatedElementInNestedTernary }`, model)
    const expected = cds.ql`SELECT from booksCalc.Ternary as Ternary
      left join booksCalc.Books as book on book.ID = Ternary.book_ID
      left join booksCalc.Authors as author on author.ID = book.author_ID
      {
        Ternary.ID,
        (case when 1 > 0 then 1 else (case when book.stock > (case when 1 > 0 then 1 else (case when book.stock > years_between(author.dateOfBirth, author.dateOfDeath) then Ternary.value else 3 end) end) then Ternary.value else 3 end) end) as calculatedElementInNestedTernary
      }`
    //                                                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    expect(query).to.deep.equal(expected)
  })
  it('list in ternary', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Ternary as Ternary { ID, nestedTernaryWithNestedXpr }`, model)
    const expected = cds.ql`SELECT from booksCalc.Ternary as Ternary
      left join booksCalc.Books as book on book.ID = Ternary.book_ID
      {
        Ternary.ID,
        (case when 1 > 0 then 1 else (case when ( (10 + book.stock) in (1, 2, 3, 4) ) then Ternary.value else 3 end) end) as nestedTernaryWithNestedXpr
      }`
    expect(query).to.deep.equal(expected)
  })
  it('in function', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, round(area, 2) as f }`, model)
    const expected = cds.ql`SELECT from booksCalc.Books as Books {
        Books.ID,
        round(Books.length * Books.width, 2) as f
      }`
    expect(query).to.deep.equal(expected)
  })
  it('in function with named param', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Authors as Authors { ID, ageNamedParams as f }`, model)
    const expected = cds.ql`SELECT from booksCalc.Authors as Authors {
      Authors.ID,
      years_between(DOB => Authors.dateOfBirth, DOD => Authors.dateOfDeath) as f
    }`
    expect(query).to.deep.equal(expected)
  })

  it('calc elem is function', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, ctitle }`, model)
    const expected = cds.ql`SELECT from booksCalc.Books as Books {
        Books.ID,
        substring(Books.title, 3, Books.stock) as ctitle
      }`
    expect(query).to.deep.equal(expected)
  })
  it('calc elem is xpr with multiple functions as args', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, authorAgeNativePG }`, model)
    const expected = cds.ql`SELECT from booksCalc.Books as Books
      left join booksCalc.Authors as author on author.ID = Books.author_ID
      {
        Books.ID,
        DATE_PART('year', author.dateOfDeath) - DATE_PART('year', author.dateOfBirth) as authorAgeNativePG
      }`
    expect(query).to.deep.equal(expected)
  })
  it('calc elem is xpr with nested xpr which has multiple functions as args', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, authorAgeInDogYears }`, model)
    const expected = cds.ql`SELECT from booksCalc.Books as Books
      left join booksCalc.Authors as author on author.ID = Books.author_ID
      {
        Books.ID,
        ( DATE_PART('year', author.dateOfDeath) - DATE_PART('year', author.dateOfBirth) ) * 7 as authorAgeInDogYears
      }`
    expect(query).to.deep.equal(expected)
  })
  it('calc elem is xpr with multiple functions as args - back and forth', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, author.books.authorAgeNativePG }`, model)
    const expected = cds.ql`SELECT from booksCalc.Books as Books
      left join booksCalc.Authors as author on author.ID = Books.author_ID
      left join booksCalc.Books as books2 on books2.author_ID = author.ID
      left join booksCalc.Authors as author2 on author2.ID = books2.author_ID
      {
        Books.ID,
        DATE_PART('year', author2.dateOfDeath) - DATE_PART('year', author2.dateOfBirth) as author_books_authorAgeNativePG
      }`
    expect(query).to.deep.equal(expected)
  })

  it('calc elem is function, nested in direct expression', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, ctitle || title as f }`, model)
    const expected = cds.ql`SELECT from booksCalc.Books as Books {
        Books.ID,
        substring(Books.title, 3, Books.stock) || Books.title as f
      }`
    expect(query).to.deep.equal(expected)
  })

  it('nested calc elems', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, volume, storageVolume }`, model)
    const expected = cds.ql`SELECT from booksCalc.Books as Books {
        Books.ID,
        (Books.length * Books.width) * Books.height as volume,
        Books.stock * ((Books.length * Books.width) * Books.height) as storageVolume
      }`
    expect(query).to.deep.equal(expected)
  })

  it('nested calc elems, nested in direct expression', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, storageVolume / volume as f }`, model)
    const expected = cds.ql`SELECT from booksCalc.Books as Books {
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
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, author.name }`, model)
    // revisit: alias follows our "regular" naming scheme -> ref.join('_')
    const expected = cds.ql`SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID {
        Books.ID,
        author.firstName || ' ' || author.lastName as author_name
      }`
    expect(query).to.deep.equal(expected)
  })

  it('via an association in columns and where', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, author.name } where author.name like '%Bro%'`, model)
    // revisit: alias follows our "regular" naming scheme -> ref.join('_')
    const expected = cds.ql`SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID {
        Books.ID,
        author.firstName || ' ' || author.lastName as author_name
      } where (author.firstName || ' ' || author.lastName) like '%Bro%'`
    expect(query).to.deep.equal(expected)
  })

  it('via an association path, nested in direct expression', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, substring(author.name, 2, stock) as f }`, model)
    const expected = cds.ql`SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID {
        Books.ID,
        substring(author.firstName || ' ' || author.lastName, 2, Books.stock) as f
      }`
    expect(query).to.deep.equal(expected)
  })

  it('via two association paths', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Authors as Authors { ID, books[stock<5].area, books[stock>5].area as a2}`, model)
    const expected = cds.ql`SELECT from booksCalc.Authors as Authors
      left outer join booksCalc.Books as books  on books.author_ID  = Authors.ID and books.stock  < 5
      left outer join booksCalc.Books as books2 on books2.author_ID = Authors.ID and books2.stock > 5
      {
        Authors.ID,
        books.length * books.width   as books_area,
        books2.length * books2.width as a2
      }`
    expect(query).to.deep.equal(expected)
  })

  it('in filter', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Authors as Authors { ID, books[area >17].title }`, model)
    // intermediate:
    // SELECT from booksCalc.Authors { ID, books[(length * width) > 1].title }
    const expected = cds.ql`SELECT from booksCalc.Authors as Authors
      left outer join booksCalc.Books as books on  books.author_ID  = Authors.ID
                                               and (books.length * books.width) > 17
      {
        Authors.ID,
        books.title as books_title
      }`
    expect(query).to.deep.equal(expected)
  })

  it('calc elem contains association', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, authorName, authorLastName }`, model)
    // intermediate:
    // SELECT from booksCalc.Books { ID, author.name, author.lastName }
    const expected = cds.ql`SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID
      {
        Books.ID,
        author.firstName || ' ' || author.lastName as authorName,
        author.lastName as authorLastName
      }`
    expect(query).to.deep.equal(expected)
  })

  it('calc elem contains associations in xpr', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, authorFullName }`, model)
    // intermediate:
    // SELECT from booksCalc.Books { ID, author.name, author.lastName }
    const expected = cds.ql`SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID
      {
        Books.ID,
        author.firstName || ' ' || author.lastName as authorFullName,
      }`
    expect(query).to.deep.equal(expected)
  })

  it('calc elem contains other calculated element in xpr with nested joins', () => {
    let query = cqn4sql(
      cds.ql`SELECT from booksCalc.Books as Books { ID, authorFullNameWithAddress } where authorFullNameWithAddress = 'foo'`,
      model,
    )
    // intermediate:
    // SELECT from booksCalc.Books { ID, author.name, author.lastName }
    const expected = cds.ql`SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID
      left outer join booksCalc.Addresses as address on address.ID = author.address_ID
      {
        Books.ID,
        (author.firstName || ' ' || author.lastName) || ' ' || (address.street || ', ' || address.city)
         as authorFullNameWithAddress,
      } where ( (author.firstName || ' ' || author.lastName) || ' ' || (address.street || ', ' || address.city) ) = 'foo'`
    expect(query).to.deep.equal(expected)
  })

  it('calc elem contains association, nested', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, authorAdrText }`, model)
    // intermediate:
    // SELECT from booksCalc.Books { ID, author.address.{street || ', ' || city} }
    const expected = cds.ql`SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID
      left outer join booksCalc.Addresses as address on address.ID = author.address_ID
      {
        Books.ID,
        address.street || ', ' || address.city as authorAdrText
      }`
    expect(query).to.deep.equal(expected)
  })

  it('calc elem contains association with filter', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Authors as Authors { ID, addressTextFilter }`, model)
    // intermediate:
    // SELECT from booksCalc.Authors { ID, address[number * 2 > 17].{street || ', ' || city}  }
    const expected = cds.ql`SELECT from booksCalc.Authors as Authors
      left outer join booksCalc.Addresses as address on address.ID = Authors.address_ID
                                                     and (address.number * 2) > 17
      {
        Authors.ID,
        address.street || ', ' || address.city as addressTextFilter
      }`
    expect(query).to.deep.equal(expected)
  })

  //
  // inline, expand
  //
  it('in inline', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, author.{name, IBAN } }`, model)
    const expected = cds.ql`SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID
      {
        Books.ID,
        author.firstName || ' ' || author.lastName as author_name,
        'DE' || author.checksum || author.sortCode  || author.accountNumber as author_IBAN
      }`
    expect(query).to.deep.equal(expected)
  })
  it('in inline back and forth', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, author.books.author.{name, IBAN } }`, model)
    const expected = cds.ql`SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID
      left outer join booksCalc.Books as books2 on books2.author_ID = author.ID
      left outer join booksCalc.Authors as author2 on author2.ID = books2.author_ID
      {
        Books.ID,
        author2.firstName || ' ' || author2.lastName as author_books_author_name,
        'DE' || author2.checksum || author2.sortCode  || author2.accountNumber as author_books_author_IBAN
      }`
    expect(query).to.deep.equal(expected)
  })
  it('in subquery, using the same calc element - not join relevant in subquery', () => {
    let query = cqn4sql(
      cds.ql`SELECT from booksCalc.Books as Books {
      ID,
      (
        SELECT from booksCalc.Authors as Authors {
          name,
          IBAN,
          addressText
        }
      ) as sub,
      author.books.author.{name, IBAN, addressText },
    }`,
      model,
    )
    const expected = cds.ql`SELECT from booksCalc.Books as Books
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
    expect(query).to.deep.equal(expected)
  })

  it('in inline, 2 assocs', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, author.{name, addressText } }`, model)
    // intermediate:
    // SELECT from booksCalc.Authors { ID, author.{firstName || ' ' || lastName, address.{street || ', ' || city}}}  }
    const expected = cds.ql`SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors   as author  on author.ID = Books.author_ID
      left outer join booksCalc.Addresses as address on address.ID = author.address_ID
      {
        Books.ID,
        author.firstName || ' ' || author.lastName as author_name,
        address.street || ', ' || address.city as author_addressText
      }`
    expect(query).to.deep.equal(expected)
  })

  it('in expand (to-one)', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, author {name, IBAN } }`, model)
    const expected = cds.ql`SELECT from booksCalc.Books as Books
      {
        Books.ID,
        (
          SELECT from booksCalc.Authors as $a {
            $a.firstName || ' ' || $a.lastName as name,
            'DE' || $a.checksum || $a.sortCode  || $a.accountNumber as IBAN
          } where Books.author_ID = $a.ID
        ) as author
      }`
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(expected)
  })

  it('in expand (to-one), 2 assocs', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, author {name, addressText } }`, model)
    const expected = cds.ql`SELECT from booksCalc.Books as Books
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
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(expected)
  })
  it('expand and inline target same calc element', () => {
    let query = cqn4sql(
      cds.ql`SELECT from booksCalc.Books as Books { ID, author.{name, addressText }, author {name, addressText } }`,
      model,
    )
    const expected = cds.ql`SELECT from booksCalc.Books as Books
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
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(expected)
  })
  it('expand and inline target same calc element inverted', () => {
    let query = cqn4sql(
      cds.ql`SELECT from booksCalc.Books as Books { ID, author {name, addressText }, author.{name, addressText } }`,
      model,
    )
    const expected = cds.ql`SELECT from booksCalc.Books as Books
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
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(expected)
  })

  it('in expand (to-many)', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Authors { ID, books { ID, area, volume } }`, model)

    const expected = cds.ql`SELECT from booksCalc.Authors as $A {
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
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(expected)
  })

  //
  // wildcard
  //

  it('via wildcard without columns', () => {
    let query = cqn4sql(
      cds.ql`SELECT from booksCalc.Books as Books excluding { length, width, height, stock, price, youngAuthorName }`,
      model,
    )
    const expected = cds.ql`SELECT from booksCalc.Books as Books
          left outer join booksCalc.Authors as author on author.ID = Books.author_ID
          left outer join booksCalc.Addresses as address on address.ID = author.address_ID
        {
          Books.ID,
          Books.title,
          Books.author_ID,

          Books.stock as stock2,
          substring(Books.title, 3, Books.stock) as ctitle,

          Books.areaS,

          Books.length * Books.width as area,
          (Books.length * Books.width) * Books.height as volume,
          Books.stock * ((Books.length * Books.width) * Books.height) as storageVolume,

          author.lastName as authorLastName,
          author.firstName || ' ' || author.lastName as authorName,
          author.firstName || ' ' || author.lastName as authorFullName,
          (author.firstName || ' ' || author.lastName) || ' ' || (address.street || ', ' || address.city) as authorFullNameWithAddress,
          address.street || ', ' || address.city as authorAdrText,
          years_between( author.sortCode, author.sortCode ) as authorAge,
          DATE_PART('year', author.dateOfDeath) - DATE_PART('year', author.dateOfBirth) as authorAgeNativePG,

          ( DATE_PART('year', author.dateOfDeath) - DATE_PART('year', author.dateOfBirth) ) * 7 as authorAgeInDogYears
        }`
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(expected)
  })

  it('via wildcard', () => {
    let query = cqn4sql(
      cds.ql`SELECT from booksCalc.Books as Books { * } excluding { length, width, height, stock, price, youngAuthorName}`,
      model,
    )
    const expected = cds.ql`SELECT from booksCalc.Books as Books
          left outer join booksCalc.Authors as author on author.ID = Books.author_ID
          left outer join booksCalc.Addresses as address on address.ID = author.address_ID
        {
          Books.ID,
          Books.title,
          Books.author_ID,

          Books.stock as stock2,
          substring(Books.title, 3, Books.stock) as ctitle,

          Books.areaS,

          Books.length * Books.width as area,
          (Books.length * Books.width) * Books.height as volume,
          Books.stock * ((Books.length * Books.width) * Books.height) as storageVolume,

          author.lastName as authorLastName,
          author.firstName || ' ' || author.lastName as authorName,
          author.firstName || ' ' || author.lastName as authorFullName,
          (author.firstName || ' ' || author.lastName) || ' ' || (address.street || ', ' || address.city) as authorFullNameWithAddress,
          address.street || ', ' || address.city as authorAdrText,
          years_between( author.sortCode, author.sortCode ) as authorAge,
          DATE_PART('year', author.dateOfDeath) - DATE_PART('year', author.dateOfBirth) as authorAgeNativePG,

          ( DATE_PART('year', author.dateOfDeath) - DATE_PART('year', author.dateOfBirth) ) * 7 as authorAgeInDogYears
        }`
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(expected)
  })

  it('wildcard select from subquery', () => {
    let query = cqn4sql(cds.ql`SELECT from ( SELECT FROM booksCalc.Simple { * } )`, model)
    const expected = cds.ql`
    SELECT from (
      SELECT from booksCalc.Simple as $S
      left join booksCalc.Simple as my on my.ID = $S.my_ID
        {
          $S.ID,
          $S.name,
          $S.my_ID,
          my.name as myName
        }
    ) as __select__ {
      __select__.ID,
      __select__.name,
      __select__.my_ID,
      __select__.myName
    }
    `
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(expected)
  })

  it('wildcard select from subquery + join relevant path expression', () => {
    let query = cqn4sql(
      cds.ql`SELECT from ( SELECT FROM booksCalc.Simple { * } ) {
        my.name as otherName
      }`,
      model,
    )
    const expected = cds.ql`
    SELECT from (
      SELECT from booksCalc.Simple as $S
      left join booksCalc.Simple as my2 on my2.ID = $S.my_ID
        {
          $S.ID,
          $S.name,
          $S.my_ID,
          my2.name as myName
        }
    ) as __select__ left join booksCalc.Simple as my on my.ID = __select__.my_ID {
      my.name as otherName
    }
    `
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(expected)
  })

  it('replacement for calculated element is considered for wildcard expansion', () => {
    let query = cqn4sql(
      cds.ql`SELECT from booksCalc.Books as Books { *, volume as ctitle } excluding { length, width, height, stock, price, youngAuthorName }`,
      model,
    )
    const expected = cds.ql`SELECT from booksCalc.Books as Books
          left outer join booksCalc.Authors as author on author.ID = Books.author_ID
          left outer join booksCalc.Addresses as address on address.ID = author.address_ID
        {
          Books.ID,
          Books.title,
          Books.author_ID,

          Books.stock as stock2,
          (Books.length * Books.width) * Books.height as ctitle,

          Books.areaS,

          Books.length * Books.width as area,
          (Books.length * Books.width) * Books.height as volume,
          Books.stock * ((Books.length * Books.width) * Books.height) as storageVolume,

          author.lastName as authorLastName,
          author.firstName || ' ' || author.lastName as authorName,
          author.firstName || ' ' || author.lastName as authorFullName,
          (author.firstName || ' ' || author.lastName) || ' ' || (address.street || ', ' || address.city) as authorFullNameWithAddress,
          address.street || ', ' || address.city as authorAdrText,
          years_between( author.sortCode, author.sortCode ) as authorAge,
          DATE_PART('year', author.dateOfDeath) - DATE_PART('year', author.dateOfBirth) as authorAgeNativePG,

          ( DATE_PART('year', author.dateOfDeath) - DATE_PART('year', author.dateOfBirth) ) * 7 as authorAgeInDogYears
        }`
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(expected)
  })

  it('calculated elements are join relevant and share same join node', () => {
    // make sure that if a join was already calculated,
    // calc elements which can use the same join have
    // their table aliases properly rewritten to the already
    // existing join node
    let query = cqn4sql(
      cds.ql`
    SELECT from booksCalc.Books as Books {
      youngAuthorName,
      authorLastName,
      authorName,
      authorFullName,
      authorAge
    }
    `,
      model,
    )

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
    expect(query).to.deep.equal(expected)
  })

  it('calculated elements are join relevant and share same join node indirect', () => {
    // make sure that if a join was already calculated,
    // calc elements which can use the same join have
    // their table aliases properly rewritten to the already
    // existing join node
    let query = cqn4sql(
      cds.ql`
    SELECT from booksCalc.Authors as Authors {
      books.youngAuthorName,
      books.authorLastName,
      books.authorName,
      books.authorFullName,
      books.authorAge
    } where books.youngAuthorName = 'King'
    `,
      model,
    )

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
    expect(query).to.deep.equal(expected)
  })

  it('calculated elements are join relevant and share same join node indirect back and forth', () => {
    // make sure that if a join was already calculated,
    // calc elements which can use the same join have
    // their table aliases properly rewritten to the already
    // existing join node
    let query = cqn4sql(
      cds.ql`
    SELECT from booksCalc.Authors as Authors {
      books.author.books.youngAuthorName,
      books.author.books.authorLastName,
      books.author.books.authorName,
      books.author.books.authorFullName,
      books.author.books.authorAge
    } where books.author.books.youngAuthorName = 'King'
    `,
      model,
    )

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
    expect(query).to.deep.equal(expected)
  })

  it('exists cannot leverage calculated elements which ends in string', () => {
    // at the leaf of a where exists path, there must be an association
    expect(() => cqn4sql(cds.ql`SELECT from booksCalc.Books { ID } where exists youngAuthorName`, model)).to.throw(
      `Expecting path “youngAuthorName” following “EXISTS” predicate to end with association/composition, found “cds.String”`,
    )
  })
  it('exists cannot leverage calculated elements which is an expression', () => {
    // at the leaf of a where exists path, there must be an association
    expect(() => cqn4sql(cds.ql`SELECT from booksCalc.Books { ID } where exists authorFullName`, model)).to.throw(
      `Expecting path “authorFullName” following “EXISTS” predicate to end with association/composition, found “expression”`,
    )
  })
  it('exists cannot leverage calculated elements w/ path expressions', () => {
    // at the leaf of a where exists path, there must be an association
    expect(() =>
      cqn4sql(cds.ql`SELECT from booksCalc.Books { ID } where exists author.books.youngAuthorName`, model),
    ).to.throw('Expecting path “author.books.youngAuthorName” following “EXISTS” predicate to end with association/composition, found “cds.String”')
  })

  it('exists cannot leverage calculated elements in CASE', () => {
    expect(() =>
      cqn4sql(
        cds.ql`SELECT from booksCalc.Books {
      ID,
      case when exists youngAuthorName then 'yes'
           else 'no'
      end as x
     }`,
        model,
      ),
    ).to.throw('Expecting path “youngAuthorName” following “EXISTS” predicate to end with association/composition, found “cds.String”')
  })

  it('scoped query cannot leverage calculated elements', () => {
    // at the leaf of a where exists path, there must be an association
    expect(() => cqn4sql(cds.ql`SELECT from booksCalc.Books:youngAuthorName { ID }`, model)).to.throw(
      'Query source must be a an entity or an association',
    )
  })

  it('via wildcard in expand subquery include complex calc element', () => {
    let query = cqn4sql(
      cds.ql`
    SELECT from booksCalc.Authors as Authors {
      books { * } excluding { length, width, height, stock, price}
    }
    `,
      model,
    )

    const expected = cds.ql`SELECT from booksCalc.Authors as Authors {
      (
        SELECT from booksCalc.Books as $b
        left outer join booksCalc.Authors as author on author.ID = $b.author_ID
                          and years_between(author.dateOfBirth, author.dateOfDeath) < 50
        left outer join booksCalc.Authors as author2 on author2.ID = $b.author_ID
        left outer join booksCalc.Addresses as address on address.ID = author2.address_ID
        {
          $b.ID,
          $b.title,
          $b.author_ID,

          $b.stock as stock2,
          substring($b.title, 3, $b.stock) as ctitle,

          $b.areaS,

          $b.length * $b.width as area,
          ($b.length * $b.width) * $b.height as volume,
          $b.stock * (($b.length * $b.width) * $b.height) as storageVolume,

          author.firstName || ' ' || author.lastName as youngAuthorName,
          author2.lastName as authorLastName,
          author2.firstName || ' ' || author2.lastName as authorName,
          author2.firstName || ' ' || author2.lastName as authorFullName,
          (author2.firstName || ' ' || author2.lastName) || ' ' || (address.street || ', ' || address.city) as authorFullNameWithAddress,
          address.street || ', ' || address.city as authorAdrText,

          years_between( author2.sortCode, author2.sortCode ) as authorAge,
          DATE_PART('year', author2.dateOfDeath) - DATE_PART('year', author2.dateOfBirth) as authorAgeNativePG,

          ( DATE_PART('year', author2.dateOfDeath) - DATE_PART('year', author2.dateOfBirth) ) * 7 as authorAgeInDogYears
        } where Authors.ID = $b.author_ID
      ) as books
    }`
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(expected)
  })
  it('via wildcard in expand subquery', () => {
    let query = cqn4sql(
      cds.ql`
    SELECT from booksCalc.Authors as Authors {
      books { * } excluding { length, width, height, stock, price, youngAuthorName}
    }
    `,
      model,
    )

    const expected = cds.ql`SELECT from booksCalc.Authors as Authors {
      (
        SELECT from booksCalc.Books as $b
          left outer join booksCalc.Authors as author on author.ID = $b.author_ID
          left outer join booksCalc.Addresses as address on address.ID = author.address_ID
        {
          $b.ID,
          $b.title,
          $b.author_ID,

          $b.stock as stock2,
          substring($b.title, 3, $b.stock) as ctitle,

          $b.areaS,

          $b.length * $b.width as area,
          ($b.length * $b.width) * $b.height as volume,
          $b.stock * (($b.length * $b.width) * $b.height) as storageVolume,

          author.lastName as authorLastName,
          author.firstName || ' ' || author.lastName as authorName,
          author.firstName || ' ' || author.lastName as authorFullName,
          (author.firstName || ' ' || author.lastName) || ' ' || (address.street || ', ' || address.city) as authorFullNameWithAddress,
          address.street || ', ' || address.city as authorAdrText,

          years_between( author.sortCode, author.sortCode ) as authorAge,
          DATE_PART('year', author.dateOfDeath) - DATE_PART('year', author.dateOfBirth) as authorAgeNativePG,

          ( DATE_PART('year', author.dateOfDeath) - DATE_PART('year', author.dateOfBirth) ) * 7 as authorAgeInDogYears
        } where Authors.ID = $b.author_ID
      ) as books
    }`
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(expected)
  })
})

describe('Unfolding calculated elements in other places', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/booksWithExpr').then(cds.linked)
  })

  it('in where', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID } where area < 13`, model)
    const expected = cds.ql`SELECT from booksCalc.Books as Books { Books.ID }
      where (Books.length * Books.width) < 13
    `
    expect(query).to.deep.equal(expected)
  })

  it('in filter in where exists', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Authors { ID } where exists books[area < 13]`, model)
    const expected = cds.ql`SELECT from booksCalc.Authors as $A { $A.ID }
      where exists (
        select 1 from booksCalc.Books as $b where $b.author_ID = $A.ID
          and ($b.length * $b.width) < 13
      )
    `
    expect(query).to.deep.equal(expected)
  })

  it('in group by & having', () => {
    let query = cqn4sql(
      cds.ql`SELECT from booksCalc.Books as Books { ID, sum(price) as tprice }
      group by ctitle having ctitle like 'A%'`,
      model,
    )
    const expected = cds.ql`SELECT from booksCalc.Books as Books {
        Books.ID, sum(Books.price) as tprice
      } group by substring(Books.title, 3, Books.stock)
        having substring(Books.title, 3, Books.stock) like 'A%'
    `
    expect(query).to.deep.equal(expected)
  })

  it('in order by', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, title } order by ctitle`, model)
    const expected = cds.ql`SELECT from booksCalc.Books as Books {
        Books.ID, Books.title
      } order by substring(Books.title, 3, Books.stock)
    `
    expect(query).to.deep.equal(expected)
  })

  it('in filter in path in FROM', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Authors[name like 'A%'].books[storageVolume < 4] { ID }`, model)
    const expected = cds.ql`SELECT from booksCalc.Books as $b {
      $b.ID
    } where exists (select 1 from booksCalc.Authors as $A
                      where $A.ID = $b.author_ID
                        and ($A.firstName || ' ' || $A.lastName) like 'A%')
                        and ($b.stock * (($b.length * $b.width) * $b.height)) < 4
    `
    expect(query).to.deep.equal(expected)
  })

  it('in a subquery', () => {
    let query = cqn4sql(
      cds.ql`SELECT from booksCalc.Books as Books {
        ID,
        (select from booksCalc.Authors as A { name }
           where A.ID = Books.author.ID and A.IBAN = Books.area + Books.ctitle) as f
      }`,
      model,
    )
    const expected = cds.ql`SELECT from booksCalc.Books as Books {
        Books.ID,
        (select from booksCalc.Authors as A { A.firstName || ' ' || A.lastName as name }
            where A.ID = Books.author_ID
            and ('DE' || A.checksum || A.sortCode  || A.accountNumber)
                 = (Books.length * Books.width) + substring(Books.title, 3, Books.stock)
        ) as f
    }`
    expect(query).to.deep.equal(expected)
  })
  it('in a function, args are join relevant', () => {
    let query = cqn4sql(
      cds.ql`SELECT from booksCalc.Books as Books {
      ID,
      authorAge
    }`,
      model,
    )
    const expected = cds.ql`
    SELECT from booksCalc.Books as Books
      left join booksCalc.Authors as author on author.ID = Books.author_ID
      {
        Books.ID,
        years_between( author.sortCode, author.sortCode ) as authorAge
      }
    `
    expect(query).to.deep.equal(expected)
  })
  it('calculated element has other calc element in infix filter', () => {
    let query = cqn4sql(
      cds.ql`SELECT from booksCalc.Books as Books {
      ID,
      youngAuthorName
    }`,
      model,
    )
    const expected = cds.ql`
    SELECT from booksCalc.Books as Books
      left join booksCalc.Authors as author on author.ID = Books.author_ID
                and years_between(author.dateOfBirth, author.dateOfDeath) < 50
      {
        Books.ID,
        author.firstName || ' ' || author.lastName as youngAuthorName
      }
    `
    expect(query).to.deep.equal(expected)
  })
  it('in a subquery calc element is join relevant', () => {
    let query = cqn4sql(
      cds.ql`SELECT from booksCalc.Books as Books {
        ID,
        (select from booksCalc.Authors as A { books.title }
           where A.ID = Books.author.ID and A.IBAN = Books.area + Books.ctitle) as f
      }`,
      model,
    )
    const expected = cds.ql`SELECT from booksCalc.Books as Books {
        Books.ID,
        (select from booksCalc.Authors as A
          left join booksCalc.Books as books2 on books2.author_ID = A.ID
          { books2.title as books_title }
            where A.ID = Books.author_ID
            and ('DE' || A.checksum || A.sortCode  || A.accountNumber)
                 = (Books.length * Books.width) + substring(Books.title, 3, Books.stock)
        ) as f
    }`
    expect(query).to.deep.equal(expected)
  })
  it('variable replacements are left untouched in calc element navigation', () => {
    const q = cds.ql`SELECT from booksCalc.VariableReplacements as VariableReplacements { ID, authorAlive.firstName }`
    const expected = cds.ql`SELECT from booksCalc.VariableReplacements as VariableReplacements
    left join booksCalc.Authors as authorAlive on ( authorAlive.ID = VariableReplacements.author_ID )
    and ( authorAlive.dateOfBirth <= $now and authorAlive.dateOfDeath >= $now and $user.unknown.foo.bar = 'Bob' )
    {
        VariableReplacements.ID,
        authorAlive.firstName as authorAlive_firstName
    }`
    expect(cqn4sql(q, model)).to.deep.equal(expected)
  })
  it('variable replacements are left untouched in calc elements via wildcard', () => {
    const q = cds.ql`SELECT from booksCalc.VariableReplacements as VariableReplacements { * }`
    const expected = cds.ql`SELECT from booksCalc.VariableReplacements as VariableReplacements
    {
        VariableReplacements.ID,
        VariableReplacements.author_ID
    }`
    expect(cqn4sql(q, model)).to.deep.equal(expected)
  })

  it('with expand', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.VariableReplacements as VariableReplacements { ID, authorAlive { ID }  }`, model)
    const expected = cds.ql`SELECT from booksCalc.VariableReplacements as VariableReplacements {
      VariableReplacements.ID,
      (
        SELECT from booksCalc.Authors as $a
        {
          $a.ID,
        }
        where ($a.ID = VariableReplacements.author_ID)
        and ( $a.dateOfBirth <= $now and $a.dateOfDeath >= $now and $user.unknown.foo.bar = 'Bob' )
      ) as authorAlive
    }`
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(expected)
  })
})

describe('Unfolding calculated elements ... misc', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/booksWithExpr').then(cds.linked)
  })
  it('calculated element on-write (stored) is not unfolded', () => {
    let query = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, areaS }`, model)
    const expected = cds.ql`SELECT from booksCalc.Books as Books { Books.ID, Books.areaS }`
    expect(query).to.deep.equal(expected)
  })
})

describe('Unfolding calculated elements and localized', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/booksWithExpr').then(cds.linked)
    model = cds.compile.for.nodejs(model)
  })

  it('presence of localized element should not affect unfolding', () => {
    const q = cds.ql`SELECT from booksCalc.LBooks as LBooks { ID, title, area }`
    q.SELECT.localized = true
    let query = cqn4sql(q, model)
    const expected = cds.ql`SELECT from localized.booksCalc.LBooks as LBooks {
        LBooks.ID,
        LBooks.title,
        LBooks.length * LBooks.width as area
      }`
    expected.SELECT.localized = true
    expect(query).to.deep.equal(expected)
  })

  it('calculated element refers to localized element', () => {
    const q = cds.ql`SELECT from booksCalc.LBooks as LBooks { ID, title, ctitle }`
    q.SELECT.localized = true
    let query = cqn4sql(q, model)
    const expected = cds.ql`SELECT from localized.booksCalc.LBooks as LBooks {
        LBooks.ID,
        LBooks.title,
        substring(LBooks.title, 3, 3) as ctitle
      }`
    expected.SELECT.localized = true
    expect(query).to.deep.equal(expected)
  })
})
