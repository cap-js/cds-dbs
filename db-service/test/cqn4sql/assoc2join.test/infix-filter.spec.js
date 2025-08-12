'use strict'

const { loadModel } = require('../helpers/model')
const cds = require('@sap/cds')
const { expect } = cds.test

let cqn4sql = require('../../../lib/cqn4sql')

describe('(a2j) in infix filter', () => {
  before(async () => {
    const m = await loadModel([__dirname + '/../../bookshop/db/schema'])
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, m)
  })

  describe('simple', () => {
    it('managed assoc', () => {
      const transformed = cqn4sql(
        cds.ql`SELECT from bookshop.Books as Books { ID, author[placeOfBirth='Marbach'].name }`,
      )
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
            and author.placeOfBirth = 'Marbach'
        {
          Books.ID,
          author.name as author_name
        }`
      expect(transformed).to.equalCqn(expected)
    })
    it('managed assoc within structure', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          dedication.addressee[name = 'Hasso'].name
        }`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Person as addressee on addressee.ID = Books.dedication_addressee_ID
            and addressee.name = 'Hasso'
        {
          Books.ID,
          addressee.name as dedication_addressee_name
        }`
      expect(transformed).to.equalCqn(expected)
    })

    it('key in filter - retrieve from target in on-condition', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID, author[ID=2].name }`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
            and author.ID = 2
        {
          Books.ID,
          author.name as author_name
        }`
      expect(transformed).to.equalCqn(expected)
    })

    it('columns need aliases - even with different filter conditions', () => {
      // TODO: belongs somewhere else
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID, author[ID=1].name, author[ID=2].name }`)).to.throw(
        /Duplicate definition of element “author_name”/,
      )
    })

    it('complex condition wrapped as expression', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          author[placeOfBirth='Marbach' OR placeOfDeath='Marbach'].name
        }`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
            and (author.placeOfBirth = 'Marbach' OR author.placeOfDeath = 'Marbach')
        {
          Books.ID,
          author.name as author_name
        }`
      expect(transformed).to.equalCqn(expected)
    })

    it('no fk optimization after infix filter', () => {
      const transformed = cqn4sql(
        cds.ql`SELECT from bookshop.Books as Books { title, author[name='Mr. X' or name = 'Mr. Y'].ID }`,
      )
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
            and (author.name='Mr. X' or author.name = 'Mr. Y')
        {
          Books.title,
          author.ID as author_ID
        }`
      expect(transformed).to.equalCqn(expected)
    })

    it('different filter conditions lead to independent joins ', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          author[placeOfBirth='Marbach'].ID as aID1
        }
        HAVING author[placeOfBirth='Foobach'].ID and genre[parent.ID='fiction'].ID`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
            and author.placeOfBirth = 'Marbach'
          left outer join bookshop.Authors as author2 on author2.ID = Books.author_ID
            and author2.placeOfBirth = 'Foobach'
          left outer join bookshop.Genres as genre on genre.ID = Books.genre_ID
            and genre.parent_ID = 'fiction'
        {
          Books.ID,
          author.ID as aID1
        }
        HAVING author2.ID and genre.ID
          `
      expect(transformed).to.equalCqn(expected)
    })

    it('same path with and without filter lead to independent joins', () => {
      const transformed = cqn4sql(cds.ql`
          SELECT from bookshop.Books as Books
          {
            ID,
            author[placeOfBirth='Marbach'].name as n1,
            author.name as n2
          }`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
            and author.placeOfBirth = 'Marbach'
          left outer join bookshop.Authors as author2 on author2.ID = Books.author_ID
        {
          Books.ID,
          author.name as n1,
          author2.name as n2
        }`
      expect(transformed).to.equalCqn(expected)
    })

    it('shared filter conditions lead to shared joins', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          author[placeOfBirth='Marbach'].name as n1,
          author[placeOfBirth='Erfurt'].name as n2,
          author[placeOfBirth='Marbach'].dateOfBirth as d1,
          author[placeOfBirth='Erfurt'].dateOfBirth as d2
        }`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
           and author.placeOfBirth = 'Marbach'
          left outer join bookshop.Authors as author2 on author2.ID = Books.author_ID
           and author2.placeOfBirth = 'Erfurt'
        { Books.ID,
          author.name as n1,
          author2.name as n2,
          author.dateOfBirth as d1,
          author2.dateOfBirth as d2
        }`
      expect(transformed).to.equalCqn(expected)
    })

    it('reversed filter conditions lead to independent joins', () => {
      let query = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          author[placeOfBirth='Marbach'].name as n1,
          author['Marbach'=placeOfBirth].name as n2
        }`,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books
            left outer join bookshop.Authors as author on author.ID = Books.author_ID AND author.placeOfBirth = 'Marbach'
            left outer join bookshop.Authors as author2 on author2.ID = Books.author_ID AND 'Marbach' = author2.placeOfBirth
            { Books.ID,
              author.name as n1,
              author2.name as n2
            }
          `)
    })
  })
})
