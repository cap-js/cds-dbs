'use strict'

const { loadModel } = require('../helpers/model')
const cds = require('@sap/cds')
const { expect } = cds.test

let cqn4sql = require('../../../lib/cqn4sql')

describe('(a2j) in where', () => {
  before(async () => {
    const m = await loadModel([__dirname + '/../../bookshop/db/schema'])
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, m)
  })

  describe('simple', () => {
    it('path ends in scalar', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID } where author.name = 'Schiller'`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
         {
           Books.ID
         }
         WHERE author.name = 'Schiller'`
      expect(transformed).to.equalCqn(expected)
    })
  })

  describe('shared prefix', () => {
  })
})
