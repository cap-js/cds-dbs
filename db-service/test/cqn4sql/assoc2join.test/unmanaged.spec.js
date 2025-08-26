'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('(a2j) unmanaged associations', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, model)
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
      expectCqn(transformed).to.equal(expected)
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
      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('shared prefix', () => {
    it('different leaf association', () => {
      const transformed = cqn4sql(cds.ql`
            SELECT from bookshop.Authors as Authors
            {
              name,
              books.genre.descr,
              books.genre.code,
              books.coAuthor.name,
              books.coAuthor.dateOfBirth
            }`)
      const expected = cds.ql`
            SELECT from bookshop.Authors as Authors
              left outer join bookshop.Books as books on books.author_ID = Authors.ID
              left outer join bookshop.Genres as genre on genre.ID = books.genre_ID
              left outer join bookshop.Authors as coAuthor on coAuthor.ID = books.coAuthor_ID
            {
              Authors.name,
              genre.descr as books_genre_descr,
              genre.code as books_genre_code,
              coAuthor.name as books_coAuthor_name,
              coAuthor.dateOfBirth as books_coAuthor_dateOfBirth
            }`
      expectCqn(transformed).to.equal(expected)
    })

    it('first node shared by all', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors as Authors
        {
          name,
          books.title as books_title,
          books.genre.descr,
          books.genre.code as books_genre_code
        }`)
      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
          left outer join bookshop.Books as books on books.author_ID = Authors.ID
          left outer join bookshop.Genres as genre on genre.ID = books.genre_ID
        {
          Authors.name,
          books.title as books_title,
          genre.descr as books_genre_descr,
          genre.code as books_genre_code
        }`

      expectCqn(transformed).to.equal(expected)
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
      expectCqn(transformed).to.equal(expected)
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
      expectCqn(transformed).to.equal(expected)
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
      expectCqn(transformed).to.equal(expected)
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
      expectCqn(transformed).to.equal(expected)
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
      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('on-condition flattening', () => {
    // everything in here is about flattening the on-conditions
    // --> the interesting part (the on-conditions) is found in the model
    it('assoc comparison', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from a2j.Foo as Foo
        {
          ID,
          buz.foo
        }`)
      const expected = cds.ql`
      SELECT from a2j.Foo as Foo
        left join a2j.Buz as buz
        on  (
              (buz.bar_ID = Foo.bar_ID AND buz.bar_foo_ID = Foo.bar_foo_ID)
              and buz.foo_ID = Foo.ID
            )
      {
        Foo.ID,
        buz.foo_ID as buz_foo_ID
      }`
      expectCqn(transformed).to.equal(expected)
    })

    it('drill into foreign keys', () => {
      const transformed = cqn4sql(cds.ql`SELECT from a2j.Foo as Foo { ID, buzUnmanaged.foo }`)
      const expected = cds.ql`
        SELECT from a2j.Foo as Foo left join a2j.Buz as buzUnmanaged
          on buzUnmanaged.bar_foo_ID = Foo.bar_foo_ID and buzUnmanaged.bar_ID = Foo.bar_ID and buzUnmanaged.foo_ID = Foo.ID
        {
          Foo.ID,
          buzUnmanaged.foo_ID as buzUnmanaged_foo_ID
        }`
      expectCqn(transformed).to.equal(expected)
    })
  })
})
