'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')

const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('(nested projections) expand structures', () => {
  before(async () => {
    const m = await loadModel()
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, m)
  })

  describe('basic', () => {
    it('with one leaf', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          dedication { addressee }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          Books.ID,
          Books.dedication_addressee_ID,
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('multiple leafs, deeply nested', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          dedication {
            addressee,
            sub { foo }
          }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          Books.ID,
          Books.dedication_addressee_ID,
          Books.dedication_sub_foo,
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('with join relevant path expression', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          ID,
          dedication { addressee.name }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as $B
          left outer join bookshop.Person as addressee on addressee.ID = $B.dedication_addressee_ID
        {
          $B.ID,
          addressee.name as dedication_addressee_name
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('with join relevant path expression w/ infix filter', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          ID,
          dedication { addressee[ID=42].name }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as $B
          left join bookshop.Person as addressee
            on addressee.ID = $B.dedication_addressee_ID
              and addressee.ID = 42
        {
          $B.ID,
          addressee.name as dedication_addressee_name
        }`

      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('wildcard', () => {
    it('substructure w/ wildcard', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          dedication {
            addressee,
            sub { * }
          }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          Books.ID,
          Books.dedication_addressee_ID,
          Books.dedication_sub_foo,
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('wildcard also applied to substructures', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          dedication { * }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          Books.ID,
          Books.dedication_addressee_ID,
          Books.dedication_text,
          Books.dedication_sub_foo,
          Books.dedication_dedication,
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('rename wildcard base', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID as foo,
          dedication as bubu {
            addressee,
            sub { * }
          }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          Books.ID as foo,
          Books.dedication_addressee_ID as bubu_addressee_ID,
          Books.dedication_sub_foo as bubu_sub_foo,
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('order by element which comes from wildcard', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          dedication as bubu {
            addressee,
            sub { * }
          }
        } order by bubu.sub.foo`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          Books.ID,
          Books.dedication_addressee_ID as bubu_addressee_ID,
          Books.dedication_sub_foo as bubu_sub_foo,
        } order by bubu_sub_foo`

      expectCqn(transformed).to.equal(expected)
    })

    it('respect order', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          dedication { text, * }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          Books.dedication_text,
          Books.dedication_addressee_ID,
          Books.dedication_sub_foo,
          Books.dedication_dedication,
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('overwrite wildcard elements (smart wildcard)', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          dedication { *, 5 as text }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          Books.ID,
          Books.dedication_addressee_ID,
          5 as dedication_text,
          Books.dedication_sub_foo,
          Books.dedication_dedication,
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('overwrite wildcard elements (smart wildcard) and respect order', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          dedication { 'first' as first, 'second' as sub, *, 5 as ![5], 'Baz' as text }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as $B
        {
          'first' as dedication_first,
          'second' as dedication_sub,
          $B.dedication_addressee_ID,
          'Baz' as dedication_text,
          $B.dedication_dedication,
          5 as dedication_5
        }`

      expectCqn(transformed).to.equal(expected)
    })
  })
})
