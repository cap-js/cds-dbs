'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn, expect } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('table alias access - in ORDER BY', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql
    cqn4sql = q => orig(q, model)
  })

  // - Name resolution in ORDER BY --------------------------------------------------------------
  // --- HANA -----------------------------------------------------------------------------------
  //   single name (w/o table alias) is resolved as (1) name of select item
  //                                                (2) then as element of data source
  //   name (w/o table alias) in expression always resolved as element of data source
  //
  // --- CDS compiler ---------------------------------------------------------------------------
  //   single path        length=1 resolved as select item
  //                      length>1 first path step resolved as table alias of data source (or $self)
  //                               then as select item
  //                               never as element of data source -> avoid changing semantics in extension
  //   path in expression length=1 resolved as element of data source
  //                      length>1 first path step resolved as table alias of data source
  //                               then as element of data source
  //                               never as select item
  //
  // --- Behavior here ---------------------------------------------------------------------------
  //   single path        length=1 resolved as select item
  //                      length>1 first path step resolved as table alias of data source (or $self)
  //                               then as select item
  //                               then as element of data source -> ok: runtime queries cannot be extended
  //   path in expression length=1 resolved as element of data source
  //                      length>1 first path step resolved as table alias of data source
  //                               then as element of data source
  //                               never as select item

  // Note: elements of data source can be used in ORDER BY w/o table alias (-> price)
  it('prefer query elements over elements of data source', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID, ID as stock, ID as x }
    order by ID, stock, Books.stock, price, x`)
    const expected = cds.ql`SELECT from bookshop.Books as Books { Books.ID, Books.ID as stock, Books.ID as x }
    order by ID, stock, Books.stock, Books.price, x`
    expectCqn(transformed).to.equal(expected)
  })

  it('prefers to resolve name in ORDER BY as select item (1)', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID as Books } ORDER BY Books`)
    const expected = cds.ql`SELECT from bookshop.Books as Books { Books.ID as Books } ORDER BY Books`
    expectCqn(transformed).to.equal(expected)
  })

  it('prefers to resolve name in ORDER BY as select item (2)', () => {
    expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID as Books } ORDER BY Books.price`)).to.throw(
      /"price" not found in "Books"/,
    )
  })

  it('respects sort property also for expressions/functions', () => {
    const transformed = cqn4sql(cds.ql`SELECT from (
                              select from bookshop.Books as Books { ID as Books } ORDER BY Books desc, sum(1+1) asc
                          ) as sub ORDER BY Books asc, 1+1 asc`)
    const expected = cds.ql`SELECT sub.Books from (
                                  select from bookshop.Books as Books { Books.ID as Books } order by Books desc, sum(1+1) asc
                              ) as sub ORDER BY Books asc, 1+1 asc`
    expectCqn(transformed).to.equal(expected)
  })

  it('resolves single name in ORDER BY as data source element even if it equals table alias', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as stock { ID } ORDER BY stock`)
    const expected = cds.ql`SELECT from bookshop.Books as stock { stock.ID } ORDER BY stock.stock`
    expectCqn(transformed).to.equal(expected)
  })

  it('for localized sorting, we must append the table alias for column refs', () => {
    // as down the line we always use collation expressions for localized sorting
    // we must prepend the table alias.
    // The simple reference will be wrapped in the expression and hence, expression name resolution rules kick in
    // see also https://github.com/cap-js/cds-dbs/issues/543
    const transformed = cqn4sql(
      SELECT.localized.from('bookshop.Books').alias('Books').columns('title', 'title as foo', 'author.name as author').orderBy('title', 'foo'),
    )
    const expected = cds.ql`
    SELECT from bookshop.Books as Books
    left join bookshop.Authors as author on author.ID = Books.author_ID
    {
      Books.title,
      Books.title as foo,
      author.name as author
    }
    ORDER BY Books.title, Books.title`
    expectCqn(transformed).to.equal(expected)
  })

  it('prepend artificial table alias if we select from anonymous subquery', async () => {
    const subquery = SELECT.localized.from('bookshop.SimpleBook').orderBy('title')
    const query = SELECT.localized.columns('ID', 'title', 'author').from(subquery).orderBy('title').groupBy('title')
    query.SELECT.count = true
    const transformed = cqn4sql(query)
    const expected = cds.ql`
      SELECT from
        (SELECT
          $S.ID,
          $S.title,
          $S.author_ID
          from bookshop.SimpleBook as $S
          order by $S.title
        ) __select__
      {
        __select__.ID,
        __select__.title,
        __select__.author_ID
      }
      group by __select__.title
      order by __select__.title
    `
    expectCqn(transformed).to.equal(expected)
  })

  it('same as above but descriptors like "asc", "desc" etc. must be kept', () => {
    const query = cds.ql`SELECT from bookshop.Books as Books {
      title,
      title as foo,
      author.name as author
    } order by title asc nulls first, foo desc nulls last`
    query.SELECT.localized = true
    const transformed = cqn4sql(query)
    const expected = cds.ql`
    SELECT from bookshop.Books as Books
    left join bookshop.Authors as author on author.ID = Books.author_ID
    {
      Books.title,
      Books.title as foo,
      author.name as author
    }
    ORDER BY Books.title asc nulls first, Books.title desc nulls last`
    expectCqn(transformed).to.equal(expected)
  })

  it('for localized sorting, replace string expression', () => {
    const query = CQL(`SELECT from bookshop.Books {
      'simple string' as foo: cds.String,
      substring('simple string') as bar: cds.String,
      'simple' || 'string' as baz: cds.String,
      author.name as author
    } order by foo, bar, baz`)
    query.SELECT.localized = true
    const transformed = cqn4sql(query)
    const expected = cds.ql`
    SELECT from bookshop.Books as $B
    left join bookshop.Authors as author on author.ID = $B.author_ID
    {
      'simple string' as foo: cds.String,
      substring('simple string') as bar: cds.String,
      'simple' || 'string' as baz: cds.String,
      author.name as author
    }
    ORDER BY 'simple string', substring('simple string'), 'simple' || 'string'`
    expectCqn(transformed).to.equal(expected)
  })

  it('supports ORDER BY clause with expressions', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID, ID as stock, ID as x }
    order by ID + stock + Books.stock + price, stock, x`)
    const expected = cds.ql`SELECT from bookshop.Books as Books { Books.ID, Books.ID as stock, Books.ID as x  }
    order by Books.ID + Books.stock + Books.stock + Books.price, stock, x`
    expectCqn(transformed).to.equal(expected)
  })

  it('fails for select items in expressions in ORDER BY', () => {
    expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID, ID as x } order by ID + x`)).to.throw(
      /"x" not found in the elements of "bookshop.Books"/,
    )
  })

  it('should be possible to address alias of function', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books { func() as bubu } order by bubu`)
    const expected = cds.ql`SELECT from bookshop.Books as $B { func() as bubu } order by bubu`
    expectCqn(transformed).to.equal(expected)
  })

  it('anonymous function gets proper alias', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books { func() }`)
    const expected = cds.ql`SELECT from bookshop.Books as $B { func() as func }`
    expectCqn(transformed).to.equal(expected)
  })

  it('anonymous function gets proper alias and can be addressed in order by', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books { func() } order by func`)
    const expected = cds.ql`SELECT from bookshop.Books as $B { func() as func } order by func`
    expectCqn(transformed).to.equal(expected)
  })

  it('do not try to resolve ref in columns if columns consists of star', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.SimpleBook { * } order by author.name`)
    const expected = cds.ql`
    SELECT from bookshop.SimpleBook as $S
    left join bookshop.Authors as author on author.ID = $S.author_ID
    {
      $S.ID,
      $S.title,
      $S.author_ID
    } order by author.name`
    expectCqn(transformed).to.equal(expected)
  })

  // doesnt work, can't join with the query source itself
  it.skip('same as above but author is explicit column', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.SimpleBook { *, author } order by author.name`)
    const expected = cds.ql`SELECT from bookshop.SimpleBook as SimpleBook left join bookshop.Authors as author on author.ID = SimpleBook.author_ID
    { SimpleBook.ID, SimpleBook.title, SimpleBook.author_ID } order by author.name`
    expectCqn(transformed).to.equal(expected)
  })
})
