'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('Unfolding calculated elements - wildcard expansion', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql
    cqn4sql = (q, m) => orig(q, m ?? model)
  })

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
