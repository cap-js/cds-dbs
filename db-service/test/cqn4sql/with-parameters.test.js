/**
 * Make sure cqn4sql always works on a copy of the incoming query, enabling
 * extension scenarios and repetitive calls.
 */
'use strict'

const { SELECT } = require('@sap/cds/lib/ql/cds-ql')
const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds')
const { expect } = cds.test
describe('entities and views with parameters', () => {
  let model
  beforeAll(async () => {
    model = await cds.load(__dirname + '/model/withParameters').then(cds.linked)
  })

  describe('associations to joins', () => {
    it('select from view with param', () => {
      const query = cqn4sql(SELECT.from('PBooks(P1: 1, P2: 2)').columns('ID'), model)
      const expected = SELECT.from('PBooks(P1: 1, P2: 2) as PBooks').columns('PBooks.ID')
      expect(query).to.deep.equal(expected)
    })
    it('follow association to entity with params', () => {
      const query = cqn4sql(SELECT.from('Books').columns('author(P1: 1, P2: 2).name as author'), model)
      const expected = cds.ql`
      SELECT FROM Books as Books left join Authors(P1:1, P2: 2) as author
        on author.ID = Books.author_ID {
          author.name as author
        }
    `
      expect(query).to.deep.equal(expected)
    })
    it('select from entity with params and follow association to entity with params', () => {
      const query = cqn4sql(SELECT.from('PBooks(P1: 42, P2: 45)').columns('author(P1: 1, P2: 2).name as author'), model)
      const expected = cds.ql`
      SELECT FROM PBooks(P1: 42, P2: 45) as PBooks left join Authors(P1:1, P2: 2) as author
        on author.ID = PBooks.author_ID {
          author.name as author
        }
    `
      expect(query).to.deep.equal(expected)
    })
    it('join identity via params', () => {
      const cqn = cds.ql`SELECT from PBooks(P1: 42, P2: 45) {
            author(P1: 1, P2: 2).name as author,
            author(P1: 1, P2: 2).name as sameAuthor,

            author(P1: 1).name as otherAuthor,

            author(P1: 1)[ID > 15].name as otherOtherAuthor,
    }`
      const query = cqn4sql(cqn, model)
      const expected = cds.ql`
      SELECT FROM PBooks(P1: 42, P2: 45) as PBooks
      left join Authors(P1:1, P2: 2) as author on author.ID = PBooks.author_ID
      left join Authors(P1:1) as author2 on author2.ID = PBooks.author_ID
      left join Authors(P1:1) as author3 on author3.ID = PBooks.author_ID and author3.ID > 15

         {
          author.name as author,
          author.name as sameAuthor,

          author2.name as otherAuthor,

          author3.name as otherOtherAuthor,
        }
    `
      expect(query).to.deep.equal(expected)
    })
    it('empty argument list if no params provided for association', () => {
      const cqn = cds.ql`SELECT from PBooks(P1: 42, P2: 45) {
            author.name as author,
    }`
      const query = cqn4sql(cqn, model)
      const expected = cds.ql`
      SELECT FROM PBooks(P1: 42, P2: 45) as PBooks
      left join Authors(P1: dummy) as author on author.ID = PBooks.author_ID
        {
          author.name as author
        }
    `
      // manually remove the param from argument list because compiler does not allow empty args for cqn
      expected.SELECT.from.args[1].ref[0].args = {}
      expect(query).to.deep.equal(expected)
    })
    it('empty argument list if no params provided for entity and association', () => {
      const cqn = cds.ql`SELECT from PBooks {
            author.name as author,
    }`
      const query = cqn4sql(cqn, model)
      const expected = cds.ql`
      SELECT FROM PBooks(P1: dummy) as PBooks
      left join Authors(P1: dummy) as author on author.ID = PBooks.author_ID
        {
          author.name as author
        }
    `
      // manually remove the param from argument list because compiler does not allow empty args for cqn
      expected.SELECT.from.args[0].ref[0].args = {}
      expected.SELECT.from.args[1].ref[0].args = {}
      expect(query).to.deep.equal(expected)
    })
    it('empty argument list for UDF', () => {
      const cqn = cds.ql`SELECT from BooksUDF {
      author.name as author,
    }`
      const query = cqn4sql(cqn, model)
      const expected = cds.ql`
      SELECT FROM BooksUDF(P1: dummy) as BooksUDF
      left join AuthorsUDF(P1: dummy) as author on author.ID = BooksUDF.author_ID
        {
          author.name as author
        }
    `
      // manually remove the param from argument list because compiler does not allow empty args for cqn
      expected.SELECT.from.args[0].ref[0].args = {}
      expected.SELECT.from.args[1].ref[0].args = {}
      expect(query).to.deep.equal(expected)
    })
  })

  describe('where exists', () => {
    it('scoped query', () => {
      const query = cds.ql`SELECT from Books:author(P1: 1, P2: 2) { ID }`
      const expected = cds.ql`
        SELECT from Authors(P1: 1, P2: 2) as author { author.ID }
          where exists (
            SELECT 1 from Books as Books where Books.author_ID = author.ID
          )
      `
      expect(cqn4sql(query, model)).to.deep.equal(expected)
    })
    it('where exists shortcut', () => {
      const query = cds.ql`SELECT from Books { ID } where exists author(P1: 1, P2: 2)`
      const expected = cds.ql`
        SELECT from Books as Books { Books.ID }
          where exists (
            SELECT 1 from Authors(P1: 1, P2: 2) as author where author.ID = Books.author_ID
          )
      `
      expect(cqn4sql(query, model)).to.deep.equal(expected)
    })
    it('where exists shortcut w/o params', () => {
      const query = cds.ql`SELECT from Books { ID } where exists author`
      const expected = cds.ql`
        SELECT from Books as Books { Books.ID }
          where exists (
            SELECT 1 from Authors(P1: dummy) as author where author.ID = Books.author_ID
          )
      `
      // manually remove the param from argument list because compiler does not allow empty args for cqn
      expected.SELECT.where[1].SELECT.from.ref[0].args = {}
      expect(cqn4sql(query, model)).to.deep.equal(expected)
    })
  })

  describe('expand subqueries', () => {
    it('expand with params', () => {
      const query = cds.ql`SELECT from Books {
        author(P1: 1, P2: 2) { ID }
      }`
      const expected = cds.ql`SELECT from Books as Books {
        (
          SELECT from Authors(P1: 1, P2: 2) as author {
            author.ID
          } where Books.author_ID = author.ID
        ) as author
      }`
      expect(JSON.parse(JSON.stringify(cqn4sql(query, model)))).to.deep.equal(expected)
    })
    it('expand on parameterized entity without args', () => {
      const query = cds.ql`SELECT from Books {
        author { ID }
      }`
      const expected = cds.ql`SELECT from Books as Books {
        (
          SELECT from Authors(P1: dummy) as author {
            author.ID
          } where Books.author_ID = author.ID
        ) as author
      }`
      // manually remove the param from argument list because compiler does not allow empty args for cqn
      expected.SELECT.columns[0].SELECT.from.ref[0].args = {}
      expect(JSON.parse(JSON.stringify(cqn4sql(query, model)))).to.deep.equal(expected)
    })
  })

  describe('subqueries', () => {
    it.skip('select from view with param which has subquery as param', () => {
      // subqueries at this location are not supported by the compiler, yet
      const query = cqn4sql(SELECT.from('PBooks(P1: 1, P2: (SELECT ID from Books))').columns('ID'), model)
      const expected = SELECT.from('PBooks(P1: 1, P2: (SELECT Books.ID from Books as Books)) as PBooks').columns(
        'PBooks.ID',
      )
      expect(query).to.deep.equal(expected)
    })
  })
})
