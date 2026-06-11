'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn, expect } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('Unfolding calculated elements in select list', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql
    cqn4sql = (q, m) => orig(q, m ?? model)
  })

  it('simple reference', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, stock2 }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books {
        Books.ID,
        Books.stock as stock2
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('simple val', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Authors as Authors { ID, IBAN }`)
    const expected = cds.ql`
      SELECT from booksCalc.Authors as Authors {
        Authors.ID,
        'DE' || Authors.checksum || Authors.sortCode || Authors.accountNumber as IBAN
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('directly', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, area }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books {
        Books.ID,
        Books.length * Books.width as area
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('in expression', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, stock * area as f }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books {
        Books.ID,
        Books.stock * ( Books.length * Books.width ) as f
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('in ternary', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Ternary as Ternary { ID, nestedTernary }`)
    const expected = cds.ql`
      SELECT from booksCalc.Ternary as Ternary
      left join booksCalc.Books as book on book.ID = Ternary.book_ID
      {
        Ternary.ID,
        (case when 1 > 0 then 1 else (case when book.stock > 10 then Ternary.value else 3 end) end) as nestedTernary
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('calcualted element in nested ternary', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Ternary as Ternary { ID, calculatedElementInNestedTernary }`)
    const expected = cds.ql`
      SELECT from booksCalc.Ternary as Ternary
      left join booksCalc.Books as book on book.ID = Ternary.book_ID
      left join booksCalc.Authors as author on author.ID = book.author_ID
      {
        Ternary.ID,
        (case when 1 > 0 then 1 else (case when book.stock > (case when 1 > 0 then 1 else (case when book.stock > years_between(author.dateOfBirth, author.dateOfDeath) then Ternary.value else 3 end) end) then Ternary.value else 3 end) end) as calculatedElementInNestedTernary
      }`
    //                                                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    expectCqn(transformed).to.equal(expected)
  })

  it('list in ternary', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Ternary as Ternary { ID, nestedTernaryWithNestedXpr }`)
    const expected = cds.ql`
      SELECT from booksCalc.Ternary as Ternary
      left join booksCalc.Books as book on book.ID = Ternary.book_ID
      {
        Ternary.ID,
        (case when 1 > 0 then 1 else (case when ( (10 + book.stock) in (1, 2, 3, 4) ) then Ternary.value else 3 end) end) as nestedTernaryWithNestedXpr
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('in function', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, round(area, 2) as f }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books {
        Books.ID,
        round(Books.length * Books.width, 2) as f
      }`
    expectCqn(transformed).to.equal(expected)
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

  it('nested calc elems', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, volume, storageVolume }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books {
        Books.ID,
        (Books.length * Books.width) * Books.height as volume,
        Books.stock * ((Books.length * Books.width) * Books.height) as storageVolume
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('nested calc elems, nested in direct expression', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, storageVolume / volume as f }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books {
        Books.ID,
        (Books.stock * ((Books.length * Books.width) * Books.height))
          / ((Books.length * Books.width) * Books.height) as f
      }`
    expectCqn(transformed).to.equal(expected)
  })

  //
  // with associations
  //

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

  it('calc elem contains other calculated element in xpr with nested joins', () => {
    const transformed = cqn4sql(
      cds.ql`SELECT from booksCalc.Books as Books { ID, authorFullNameWithAddress } where authorFullNameWithAddress = 'foo'`,
    )
    // intermediate:
    // SELECT from booksCalc.Books { ID, author.name, author.lastName }
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID
      left outer join booksCalc.Addresses as address on address.ID = author.address_ID
      {
        Books.ID,
        (author.firstName || ' ' || author.lastName) || ' ' || (address.street || ', ' || address.city)
         as authorFullNameWithAddress,
      } where ( (author.firstName || ' ' || author.lastName) || ' ' || (address.street || ', ' || address.city) ) = 'foo'`
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

  //
  // inline, expand
  //

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

  //
  // wildcard
  //

  it('via wildcard without columns', () => {
    const transformed = cqn4sql(
      cds.ql`SELECT from booksCalc.Books as Books excluding { length, width, height, stock, price, youngAuthorName }`,
    )
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books
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
    expectCqn(transformed).to.equal(expected)
  })

  it('via wildcard', () => {
    const transformed = cqn4sql(
      cds.ql`SELECT from booksCalc.Books as Books { * } excluding { length, width, height, stock, price, youngAuthorName}`,
    )
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books
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
    expectCqn(transformed).to.equal(expected)
  })

  it('wildcard select from subquery', () => {
    const transformed = cqn4sql(cds.ql`SELECT from ( SELECT FROM booksCalc.Simple { * } )`)
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
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('wildcard select from subquery + join relevant path expression', () => {
    const transformed = cqn4sql(
      cds.ql`SELECT from ( SELECT FROM booksCalc.Simple { * } ) {
        my.name as otherName
      }`,
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
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('replacement for calculated element is considered for wildcard expansion', () => {
    const transformed = cqn4sql(
      cds.ql`SELECT from booksCalc.Books as Books { *, volume as ctitle } excluding { length, width, height, stock, price, youngAuthorName }`,
    )
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books
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
    expectCqn(transformed).to.equal(expected)
  })

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

  it('exists cannot leverage calculated elements which ends in string', () => {
    // at the leaf of a where exists path, there must be an association
    expect(() => cqn4sql(cds.ql`SELECT from booksCalc.Books { ID } where exists youngAuthorName`)).to.throw(
      `Expecting path “youngAuthorName” following “EXISTS” predicate to end with association/composition, found “cds.String”`,
    )
  })

  it('exists cannot leverage calculated elements which is an expression', () => {
    // at the leaf of a where exists path, there must be an association
    expect(() => cqn4sql(cds.ql`SELECT from booksCalc.Books { ID } where exists authorFullName`)).to.throw(
      `Expecting path “authorFullName” following “EXISTS” predicate to end with association/composition, found “expression”`,
    )
  })

  it('exists cannot leverage calculated elements w/ path expressions', () => {
    // at the leaf of a where exists path, there must be an association
    expect(() =>
      cqn4sql(cds.ql`SELECT from booksCalc.Books { ID } where exists author.books.youngAuthorName`),
    ).to.throw('Expecting path “author.books.youngAuthorName” following “EXISTS” predicate to end with association/composition, found “cds.String”')
  })

  it('exists cannot leverage calculated elements in CASE', () => {
    expect(() =>
      cqn4sql(cds.ql`SELECT from booksCalc.Books {
        ID,
        case when exists youngAuthorName then 'yes'
             else 'no'
        end as x
      }`),
    ).to.throw('Expecting path “youngAuthorName” following “EXISTS” predicate to end with association/composition, found “cds.String”')
  })

  it('scoped query cannot leverage calculated elements', () => {
    // at the leaf of a where exists path, there must be an association
    expect(() => cqn4sql(cds.ql`SELECT from booksCalc.Books:youngAuthorName { ID }`)).to.throw(
      'Query source must be a an entity or an association',
    )
  })

  it('via wildcard in expand subquery include complex calc element', () => {
    const transformed = cqn4sql(cds.ql`
      SELECT from booksCalc.Authors as Authors {
        books { * } excluding { length, width, height, stock, price}
      }
    `)
    const expected = cds.ql`
      SELECT from booksCalc.Authors as Authors {
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
    expectCqn(transformed).to.equal(expected)
  })

  it('via wildcard in expand subquery', () => {
    const transformed = cqn4sql(cds.ql`
      SELECT from booksCalc.Authors as Authors {
        books { * } excluding { length, width, height, stock, price, youngAuthorName}
      }
    `)
    const expected = cds.ql`
      SELECT from booksCalc.Authors as Authors {
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
    expectCqn(transformed).to.equal(expected)
  })
})
