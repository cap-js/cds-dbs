'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('(exist predicate) detection in other places', () => {
  before(async () => {
    const m = await loadModel()
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, m)
  })

  describe('basic', () => {
    it('exists in select clause', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          ID,
          genre[exists children].descr
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as $B
          left outer join bookshop.Genres as genre
            on genre.ID = $B.genre_ID
            and EXISTS (
              SELECT 1 from bookshop.Genres as $c
              WHERE $c.parent_ID = genre.ID
            )
        {
          $B.ID,
          genre.descr as genre_descr
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('exists in select clause with nested exists', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          ID,
          genre[exists children[exists children]].descr
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as $B
          left outer join bookshop.Genres as genre
            on genre.ID = $B.genre_ID
            and EXISTS (
              SELECT 1 from bookshop.Genres as $c
              WHERE $c.parent_ID = genre.ID
                and EXISTS (
                  SELECT 1 from bookshop.Genres as $c2
                  WHERE $c2.parent_ID = $c.ID
                )
            )
        {
          $B.ID,
          genre.descr as genre_descr
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('nested exists in select clause in both steps of path expression', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          ID,
          genre[exists children[code = 2]].children[exists children[code = 3]].descr
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as $B
          left outer join bookshop.Genres as genre
            on genre.ID = $B.genre_ID
            and EXISTS (
              SELECT 1 from bookshop.Genres as $c
              WHERE $c.parent_ID = genre.ID
                and $c.code = 2
            )
          left outer join bookshop.Genres as children
            on children.parent_ID = genre.ID
            and EXISTS (
              SELECT 1 from bookshop.Genres as $c2
              WHERE $c2.parent_ID = children.ID
                and $c2.code = 3
            )
        {
          $B.ID,
          children.descr as genre_children_descr
        }`

      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('in `case … when … then …`  statements', () => {
    it('basic', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          ID,
          case when exists author then 'yes'
               else 'no'
          end as x
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as $B
        {
          $B.ID,
          case
            when exists (
              SELECT 1 from bookshop.Authors as $a
              WHERE $a.ID = $B.author_ID
            ) then 'yes'
            else 'no'
          end as x
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('negated exists with disjunction', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          ID,
          case when not (exists author[name = 'FOO'] or exists author[name = 'BAR']) then 'yes'
               else 'no'
          end as x
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as $B
        {
          $B.ID,
          case
            when not (
              exists (
                SELECT 1 from bookshop.Authors as $a
                WHERE $a.ID = $B.author_ID
                  and $a.name = 'FOO'
              )
              or exists (
                SELECT 1 from bookshop.Authors as $a2
                WHERE $a2.ID = $B.author_ID
                  and $a2.name = 'BAR'
              )
            ) then 'yes'
            else 'no'
          end as x
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('exists with filter in case expression', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          ID,
          case when exists author[name = 'Sanderson'] then 'yes'
               else 'no'
          end as x
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as $B
        {
          $B.ID,
          case
            when exists (
              SELECT 1 from bookshop.Authors as $a
              WHERE $a.ID = $B.author_ID
                and $a.name = 'Sanderson'
            ) then 'yes'
            else 'no'
          end as x
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('multiple branches, each with exists', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors
        {
          ID,
          case
            when exists books[price > 10] then 1
            when exists books[price > 100] then 2
          end as descr
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as $A
        {
          $A.ID,
          case
            when exists (
              SELECT 1 from bookshop.Books as $b
              WHERE $b.author_ID = $A.ID
                and $b.price > 10
            ) then 1
            when exists (
              SELECT 1 from bookshop.Books as $b2
              WHERE $b2.author_ID = $A.ID
                and $b2.price > 100
            ) then 2
          end as descr
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('multiple branches, each with association-like calculated element', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors
        {
          ID,
          case
            when exists booksWithALotInStock[price > 10 or price < 20] then 1
            when exists booksWithALotInStock[price > 100 or price < 120] then 2
          end as descr
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as $A
        {
          $A.ID,
          case
            when exists (
              SELECT 1 from bookshop.Books as $b
              WHERE ( $b.author_ID = $A.ID )
                and ( $b.stock > 100 )
                and ( $b.price > 10 or $b.price < 20 )
            ) then 1
            when exists (
              SELECT 1 from bookshop.Books as $b2
              WHERE ( $b2.author_ID = $A.ID )
                and ( $b2.stock > 100 )
                and ( $b2.price > 100 or $b2.price < 120 )
            ) then 2
          end as descr
        }`

      expectCqn(transformed).to.equal(expected)
    })
  })
})
