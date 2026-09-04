'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('table alias access - in WHERE, GROUP BY, HAVING', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql
    cqn4sql = q => orig(q, model)
  })

  it('WHERE with implicit table alias', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID } WHERE ID = 1 and Books.stock <> 1`)
    const expected = cds.ql`SELECT from bookshop.Books as Books { Books.ID } WHERE Books.ID = 1 and Books.stock <> 1`
    expectCqn(transformed).to.equal(expected)
  })

  it('treat ref with param: true as value', () => {
    const transformed = cqn4sql({
      SELECT: {
        columns: [{ ref: ['ID'] }, { ref: ['?'], param: true, as: 'discount' }],
        from: { ref: ['bookshop.Books'], as: 'Books' },
        where: [{ ref: ['ID'] }, '=', { ref: ['?'], param: true }],
      },
    })
    const expected = cds.ql`SELECT Books.ID, ? as discount from bookshop.Books as Books WHERE Books.ID = ?`
    expectCqn(transformed).to.equal(expected)
  })

  it('WHERE with explicit table alias', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as Bar { ID } WHERE ID = 1 and Bar.stock <> 1`)
    const expected = cds.ql`SELECT from bookshop.Books as Bar { Bar.ID } WHERE Bar.ID = 1 and Bar.stock <> 1`
    expectCqn(transformed).to.equal(expected)
  })

  it('WHERE with explicit table alias that equals field name', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as stock { ID } WHERE stock.ID = 1 and stock <> 1`)
    const expected = cds.ql`SELECT from bookshop.Books as stock { stock.ID } WHERE stock.ID = 1 and stock.stock <> 1`
    expectCqn(transformed).to.equal(expected)
  })

  it('allows access to and prepends table alias in GROUP BY/HAVING clause', () => {
    const transformed = cqn4sql(
      cds.ql`SELECT from bookshop.Books as Books { stock }
          group by stock, Books.title having stock > 5 and Books.title = 'foo'`,
    )
    const expected = cds.ql`SELECT from bookshop.Books as Books { Books.stock }
          group by Books.stock, Books.title having Books.stock > 5 and Books.title = 'foo'`
    expectCqn(transformed).to.equal(expected)
  })

  it('xpr in filter within where exists shortcut', () => {
    // the `not` in front of `(name = 'King')` makes it an xpr
    // --> make sure we cover this path and prepend aliases
    const transformed = cqn4sql(cds.ql`
      SELECT ID
        from bookshop.Books as Books
        where not exists coAuthorUnmanaged[not (name = 'King')]
        order by ID asc
    `)
    const expected = cds.ql`
      SELECT Books.ID from bookshop.Books as Books
        where not exists (
          SELECT 1 from bookshop.Authors as $c
            where $c.ID = Books.coAuthor_ID_unmanaged and not ($c.name = 'King')
        )
        order by ID asc
    `
    expectCqn(transformed).to.equal(expected)
  })

  it('xpr in filter in having', () => {
    // the `not` in front of `(name = 'King')` makes it an xpr
    // --> make sure we cover this path and prepend aliases
    const transformed = cqn4sql(cds.ql`
      SELECT ID
        from bookshop.Books as Books
        having coAuthorUnmanaged[not (name = 'King')].name
        order by ID asc
    `)
    const expected = cds.ql`
      SELECT Books.ID from bookshop.Books as Books
        left join bookshop.Authors as coAuthorUnmanaged
          on coAuthorUnmanaged.ID = Books.coAuthor_ID_unmanaged and not (coAuthorUnmanaged.name = 'King')
        having coAuthorUnmanaged.name
        order by ID asc
    `
    expectCqn(transformed).to.equal(expected)
  })

  it('xpr in filter in group by', () => {
    // the `not` in front of `(name = 'King')` makes it an xpr
    // --> make sure we cover this path and prepend aliases
    const transformed = cqn4sql(cds.ql`
      SELECT ID
        from bookshop.Books as Books
        group by coAuthorUnmanaged[not (name = 'King')].name
        order by ID asc
    `)
    const expected = cds.ql`
      SELECT Books.ID from bookshop.Books as Books
        left join bookshop.Authors as coAuthorUnmanaged
          on coAuthorUnmanaged.ID = Books.coAuthor_ID_unmanaged and not (coAuthorUnmanaged.name = 'King')
        group by coAuthorUnmanaged.name
        order by ID asc
    `
    expectCqn(transformed).to.equal(expected)
  })

  it('xpr in filter in order by', () => {
    // the `not` in front of `(name = 'King')` makes it an xpr
    // --> make sure we cover this path and prepend aliases
    const transformed = cqn4sql(cds.ql`
      SELECT ID
        from bookshop.Books as Books
        order by coAuthorUnmanaged[not (name = 'King')].name
    `)
    const expected = cds.ql`
      SELECT Books.ID from bookshop.Books as Books
        left join bookshop.Authors as coAuthorUnmanaged
          on coAuthorUnmanaged.ID = Books.coAuthor_ID_unmanaged and not (coAuthorUnmanaged.name = 'King')
        order by coAuthorUnmanaged.name
    `
    expectCqn(transformed).to.equal(expected)
  })
})
