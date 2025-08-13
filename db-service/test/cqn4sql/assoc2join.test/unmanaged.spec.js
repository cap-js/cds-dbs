'use strict'

const { loadModel } = require('../helpers/model')
const cds = require('@sap/cds')
const { expect } = cds.test
require('../helpers/test.setup')

let cqn4sql = require('../../../lib/cqn4sql')

describe('(a2j) unmanaged associations', () => {
  before(async () => {
    const m = await loadModel([__dirname + '/../../bookshop/db/schema'])
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, m)
  })

  describe('simple', () => {
    it('path ends in scalar', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          coAuthorUnmanaged.name
        }`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as coAuthorUnmanaged
            on coAuthorUnmanaged.ID = Books.coAuthor_ID_unmanaged
        {
          Books.ID,
          coAuthorUnmanaged.name as coAuthorUnmanaged_name
        }`
      expect(transformed).to.equalCqn(expected)
    })

    it('path to target key', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Baz as Baz
        {
          id,
          parent.id as pid
        }`)
      const expected = cds.ql`
        SELECT from bookshop.Baz as Baz
          left outer join bookshop.Baz as parent
            on parent.id = Baz.parent_id or parent.id > 17
        {
          Baz.id,
          parent.id as pid
        }`
      expect(transformed).to.equalCqn(expected)
    })
  })

  describe('with filter', () => {
    it('basic', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Baz as Baz
        {
          id,
          parent[id < 19].id as pid
        }`)
      const expected = cds.ql`
        SELECT from bookshop.Baz as Baz
          left outer join bookshop.Baz as parent
            on (parent.id = Baz.parent_id or parent.id > 17) and parent.id < 19
        {
          Baz.id,
          parent.id as pid
        }`
      expect(transformed).to.equalCqn(expected)
    })
  })

  describe('variations in on-conditions', () => {
    it('on-condition with length === 1', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.BooksWithWeirdOnConditions as BooksWithWeirdOnConditions
        {
          ID,
          onlyOneRef.foo
        }`)
      const expected = cds.ql`
        SELECT from bookshop.BooksWithWeirdOnConditions as BooksWithWeirdOnConditions
          left outer join bookshop.BooksWithWeirdOnConditions as onlyOneRef
            on BooksWithWeirdOnConditions.ID
        {
          BooksWithWeirdOnConditions.ID,
          onlyOneRef.foo as onlyOneRef_foo
        }`
      expect(transformed).to.equalCqn(expected)
    })

    it('on-condition with odd length', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.BooksWithWeirdOnConditions as BooksWithWeirdOnConditions
        {
          ID,
          oddNumber.foo
        }`)
      const expected = cds.ql`
        SELECT from bookshop.BooksWithWeirdOnConditions as BooksWithWeirdOnConditions
          left outer join bookshop.BooksWithWeirdOnConditions as oddNumber
            on BooksWithWeirdOnConditions.foo / 5 + BooksWithWeirdOnConditions.ID = BooksWithWeirdOnConditions.ID + BooksWithWeirdOnConditions.foo
        {
          BooksWithWeirdOnConditions.ID,
          oddNumber.foo as oddNumber_foo
        }`
      expect(transformed).to.equalCqn(expected)
    })

    it('on-condition accessing structured foreign keys', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.BooksWithWeirdOnConditions as BooksWithWeirdOnConditions
        {
          ID,
          oddNumberWithForeignKeyAccess.second
        }`)
      const expected = cds.ql`
        SELECT from bookshop.BooksWithWeirdOnConditions as BooksWithWeirdOnConditions
          left outer join bookshop.WithStructuredKey as oddNumberWithForeignKeyAccess
            on oddNumberWithForeignKeyAccess.struct_mid_anotherLeaf = oddNumberWithForeignKeyAccess.struct_mid_leaf / oddNumberWithForeignKeyAccess.second
        {
          BooksWithWeirdOnConditions.ID,
          oddNumberWithForeignKeyAccess.second as oddNumberWithForeignKeyAccess_second
        }`
      expect(transformed).to.equalCqn(expected)
    })

    it('on-condition comparing to val', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.BooksWithWeirdOnConditions as BooksWithWeirdOnConditions
        {
          ID,
          refComparedToVal.refComparedToValFlipped.foo
        }`)
      const expected = cds.ql`
        SELECT from bookshop.BooksWithWeirdOnConditions as BooksWithWeirdOnConditions
          left outer join bookshop.BooksWithWeirdOnConditions as refComparedToVal
            on BooksWithWeirdOnConditions.ID != 1
          left outer join bookshop.BooksWithWeirdOnConditions as refComparedToValFlipped
            on 1 != refComparedToVal.ID
        {
          BooksWithWeirdOnConditions.ID,
          refComparedToValFlipped.foo as refComparedToVal_refComparedToValFlipped_foo
        }`
      expect(transformed).to.equalCqn(expected)
    })
  })
})
