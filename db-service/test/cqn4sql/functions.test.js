'use strict'

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds/lib')
const { expect } = cds.test
describe('functions', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })
  describe('general', () => {
    it('function in filter of expand', () => {
      const q = CQL`SELECT from bookshop.Books {
          author[substring(placeOfBirth, 0, 2) = 'DE'] { name }
        }`
      const qx = CQL`SELECT from bookshop.Books as Books {
          (
            SELECT author.name
             from bookshop.Authors as author
             where Books.author_ID = author.ID and
             substring(author.placeOfBirth, 0, 2) = 'DE'

          ) as author
        }`
      const res = cqn4sql(q, model)
      expect(res.SELECT.columns[0].SELECT).to.have.property('expand').that.equals(true)
      expect(res.SELECT.columns[0].SELECT).to.have.property('one').that.equals(true)
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
    })
    it('function val in func.args must not be expanded to fk comparison', () => {
      const q = CQL`SELECT from bookshop.Books {
         1
        } where not exists author[contains(toLower('foo'))]`
      const qx = CQL`SELECT from bookshop.Books as Books {
          1
        } where not exists (
          SELECT 1 from bookshop.Authors as author where author.ID = Books.author_ID and contains(toLower('foo'))
        )`
      const res = cqn4sql(q, model)
      expect(res).to.deep.equal(qx)
    })
    it('function with dot operator', () => {
      const q = CQL`SELECT from bookshop.Books {
         func1(ID, 'bar').func2(author.name, 'foo') as dotOperator
        } `
      const qx = CQL`
        SELECT from bookshop.Books as Books left join bookshop.Authors as author on author.ID = Books.author_ID
        {
          func1(Books.ID, 'bar').func2(author.name, 'foo') as dotOperator
        }`
      const res = cqn4sql(q, model)
      expect(res).to.deep.equal(qx)
    })
  })

  describe('without arguments', () => {
    it('function in filter in order by', () => {
      let query = {
        SELECT: {
          from: { ref: ['bookshop.Books'] },
          columns: [{ ref: ['ID'] }],
          where: [{ func: 'current_date' }, '=', { val: 'today' }],
        },
      }
      let expected = CQL`
        SELECT Books.ID from bookshop.Books as Books
       where current_date = 'today'
      `

      let result = cqn4sql(query, model)
      expect(result).to.deep.equal(expected)
    })
  })
})
