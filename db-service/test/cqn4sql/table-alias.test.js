'use strict'

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds')
const { expect } = cds.test
describe('table alias access', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  describe('implicit aliasing', () => {
    it('can handle entities beginning with $', () => {
      const query = cds.ql`SELECT from bookshop.![$special] { ID }`
      const result = cqn4sql(query, model)
      expect(result).to.deep.equal(cds.ql`SELECT from bookshop.$special as $s { $s.ID }`)
    })
    // TODO: also use technical alias for join nodes
    it('can handle entities beginning with $ and joins for assocs starting with $', () => {
      const query = cds.ql`SELECT from bookshop.![$special] { ID, ![$special].name }`
      const result = cqn4sql(query, model)
      expect(result).to.deep.equal(
        cds.ql`SELECT from bookshop.$special as $s left join bookshop.$special as $special on $special.ID = $s.$special_ID
        {
          $s.ID,
          $special.name as $special_name
        }`
      )
    })
    it('can handle scoped queries via navigations starting with $', () => {
      const query = cds.ql`SELECT from bookshop.$special:$special { ID }`
      const result = cqn4sql(query, model)
      expect(result).to.deep.equal(
        cds.ql`
        SELECT from bookshop.$special as $s { $s.ID }
        where exists (SELECT 1 from bookshop.$special as $s2 where $s2.$special_ID = $s.ID)
      `)
    })
    it('can handle expand queries via navigations starting with $', () => {
      const query = cds.ql`SELECT from bookshop.$special { ID, $special { name } }`
      const result = cqn4sql(query, model)
      expect(JSON.parse(JSON.stringify(result))).to.deep.equal(
        cds.ql`
        SELECT from bookshop.$special as $s {
          $s.ID,
          (SELECT $s2.name from bookshop.$special as $s2 where $s.$special_ID = $s2.ID) as $special
        }
      `)
    })

    // entity called "$" with association called "$" to entity called "$"
    it('can handle entities beginning with $', () => {
      const query = cds.ql`SELECT from bookshop.$ { ID }`
      const result = cqn4sql(query, model)
      expect(result).to.deep.equal(cds.ql`SELECT from bookshop.$ as $$ { $$.ID }`)
    })

    // TODO: also use technical alias for join nodes
    it('can handle entities called $ and joins for assocs called $', () => {
      const query = cds.ql`SELECT from bookshop.$ { ID, $.name }`
      const result = cqn4sql(query, model)
      expect(result).to.deep.equal(
        cds.ql`SELECT from bookshop.$ as $$ left join bookshop.$ as $ on $.ID = $$.$_ID
        {
          $$.ID,
          $.name as $_name
        }`
      )
    })

    it('can handle scoped queries via navigations called $', () => {
      const query = cds.ql`SELECT from bookshop.$:$ { ID }`
      const result = cqn4sql(query, model)
      expect(result).to.deep.equal(
        cds.ql`
        SELECT from bookshop.$ as $$ { $$.ID }
        where exists (SELECT 1 from bookshop.$ as $$2 where $$2.$_ID = $$.ID)
      `)
    })

    it('can handle expand queries via navigations called $', () => {
      const query = cds.ql`SELECT from bookshop.$ { ID, $ { name } }`
      const result = cqn4sql(query, model)
      expect(JSON.parse(JSON.stringify(result))).to.deep.equal(
        cds.ql`
        SELECT from bookshop.$ as $$ {
          $$.ID,
          (SELECT $$2.name from bookshop.$ as $$2 where $$.$_ID = $$2.ID) as $
        }
      `)
    })

  })

  describe('in columns', () => {
    it('makes implicit table alias explicit and uses it for access', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Books { ID }`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as $B { $B.ID }`)
    })

    it('creates unique alias for anonymous query which selects from other query', () => {
      let query = cqn4sql(cds.ql`SELECT from (SELECT from bookshop.Books { ID } )`, model)
      expect(query).to.deep.equal(
        cds.ql`SELECT from (SELECT from bookshop.Books as $B { $B.ID }) as __select__ { __select__.ID }`,
      )
    })

    it('the unique alias for anonymous query does not collide with user provided aliases', () => {
      let query = cqn4sql(cds.ql`SELECT from (SELECT from bookshop.Books as __select__ { ID } )`, model)
      expect(query).to.deep.equal(
        cds.ql`SELECT from (SELECT from bookshop.Books as __select__ { __select__.ID }) as __select__2 { __select__2.ID }`,
      )
    })
    it('the unique alias for anonymous query does not collide with user provided aliases in case of joins', () => {
      let query = cqn4sql(
        cds.ql`SELECT from (SELECT from bookshop.Books as __select__ { ID, author } ) { author.name }`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`
      SELECT from (
        SELECT from bookshop.Books as __select__ { __select__.ID, __select__.author_ID }
      ) as __select__2 left join bookshop.Authors as author on author.ID = __select__2.author_ID
      {
        author.name as author_name
      }`)
    })

    it('the unique alias for anonymous query does not collide with user provided aliases nested', () => {
      // author association bubbles up to the top query where the join finally is done
      // --> note that the most outer query uses user defined __select__ alias
      let query = cqn4sql(
        cds.ql`
      SELECT from (
        SELECT from (
          SELECT from bookshop.Books as Books { ID, author }
        )
      ) as __select__
      {
        __select__.author.name
      }`,
        model,
      )
      expect(query).to.deep.equal(
        cds.ql`
        SELECT from (
          SELECT from (
            SELECT from bookshop.Books as Books { Books.ID, Books.author_ID }
            ) as __select__2 { __select__2.ID, __select__2.author_ID }
        ) as __select__ left join bookshop.Authors as author on author.ID = __select__.author_ID
        {
          author.name as author_name
        }`,
      )
    })

    it('preserves table alias at field access', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { Books.ID }`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books { Books.ID }`)
    })

    it('handles field access with and without table alias', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID, Books.stock }`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books { Books.ID, Books.stock }`)
    })

    it('supports user defined table alias', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Books as A { A.ID, stock }`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as A { A.ID, A.stock }`)
    })

    it('user defined table alias equals field name', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Books as stock { stock.ID, stock, stock.stock as s2 }`, model)
      expect(query).to.deep.equal(
        cds.ql`SELECT from bookshop.Books as stock { stock.ID, stock.stock, stock.stock as s2 }`,
      )
    })

    it('supports scoped entity names', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Books.twin as twin { ID }`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books.twin as twin { twin.ID }`)
    })
  })

  describe('in WHERE, GROUP BY, HAVING', () => {
    it('WHERE with implicit table alias', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID } WHERE ID = 1 and Books.stock <> 1`, model)
      expect(query).to.deep.equal(
        cds.ql`SELECT from bookshop.Books as Books { Books.ID } WHERE Books.ID = 1 and Books.stock <> 1`,
      )
    })

    it('treat ref with param: true as value', () => {
      const query = {
        SELECT: {
          columns: [{ ref: ['ID'] }, { ref: ['?'], param: true, as: 'discount' }],
          from: { ref: ['bookshop.Books'], as: 'Books' },
          where: [{ ref: ['ID'] }, '=', { ref: ['?'], param: true }],
        },
      }
      expect(cqn4sql(query, model)).to.deep.equal(
        cds.ql`SELECT Books.ID, ? as discount from bookshop.Books as Books WHERE Books.ID = ?`,
      )
    })

    it('WHERE with explicit table alias', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Books as Bar { ID } WHERE ID = 1 and Bar.stock <> 1`, model)
      expect(query).to.deep.equal(
        cds.ql`SELECT from bookshop.Books as Bar { Bar.ID } WHERE Bar.ID = 1 and Bar.stock <> 1`,
      )
    })

    it('WHERE with explicit table alias that equals field name', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Books as stock { ID } WHERE stock.ID = 1 and stock <> 1`, model)
      expect(query).to.deep.equal(
        cds.ql`SELECT from bookshop.Books as stock { stock.ID } WHERE stock.ID = 1 and stock.stock <> 1`,
      )
    })

    it('allows access to and prepends table alias in GROUP BY/HAVING clause', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books as Books { stock }
            group by stock, Books.title having stock > 5 and Books.title = 'foo'`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books { Books.stock }
            group by Books.stock, Books.title having Books.stock > 5 and Books.title = 'foo'`)
    })

    it('xpr in filter within where exists shortcut', () => {
      // the `not` in front of `(name = 'King')` makes it an xpr
      // --> make sure we cover this path and prepend aliases
      let query = cds.ql`
        SELECT ID
          from bookshop.Books as Books
          where not exists coAuthorUnmanaged[not (name = 'King')]
          order by ID asc
      `
      let expected = cds.ql`
        SELECT Books.ID from bookshop.Books as Books
          where not exists (
            SELECT 1 from bookshop.Authors as $c
              where $c.ID = Books.coAuthor_ID_unmanaged and not ($c.name = 'King')
          )
          order by ID asc
      `

      let result = cqn4sql(query, model)
      expect(result).to.deep.equal(expected)
    })

    it('xpr in filter in having', () => {
      // the `not` in front of `(name = 'King')` makes it an xpr
      // --> make sure we cover this path and prepend aliases
      let query = cds.ql`
        SELECT ID
          from bookshop.Books as Books
          having coAuthorUnmanaged[not (name = 'King')].name
          order by ID asc
      `
      let expected = cds.ql`
        SELECT Books.ID from bookshop.Books as Books
          left join bookshop.Authors as coAuthorUnmanaged
            on coAuthorUnmanaged.ID = Books.coAuthor_ID_unmanaged and not (coAuthorUnmanaged.name = 'King')
          having coAuthorUnmanaged.name
          order by ID asc
      `

      let result = cqn4sql(query, model)
      expect(result).to.deep.equal(expected)
    })

    it('xpr in filter in group by', () => {
      // the `not` in front of `(name = 'King')` makes it an xpr
      // --> make sure we cover this path and prepend aliases
      let query = cds.ql`
        SELECT ID
          from bookshop.Books as Books
          group by coAuthorUnmanaged[not (name = 'King')].name
          order by ID asc
      `
      let expected = cds.ql`
        SELECT Books.ID from bookshop.Books as Books
          left join bookshop.Authors as coAuthorUnmanaged
            on coAuthorUnmanaged.ID = Books.coAuthor_ID_unmanaged and not (coAuthorUnmanaged.name = 'King')
          group by coAuthorUnmanaged.name
          order by ID asc
      `

      let result = cqn4sql(query, model)
      expect(result).to.deep.equal(expected)
    })
    it('xpr in filter in order by', () => {
      // the `not` in front of `(name = 'King')` makes it an xpr
      // --> make sure we cover this path and prepend aliases
      let query = cds.ql`
        SELECT ID
          from bookshop.Books as Books
          order by coAuthorUnmanaged[not (name = 'King')].name
      `
      let expected = cds.ql`
        SELECT Books.ID from bookshop.Books as Books
          left join bookshop.Authors as coAuthorUnmanaged
            on coAuthorUnmanaged.ID = Books.coAuthor_ID_unmanaged and not (coAuthorUnmanaged.name = 'King')
          order by coAuthorUnmanaged.name
      `

      let result = cqn4sql(query, model)
      expect(result).to.deep.equal(expected)
    })
  })

  describe('in function args', () => {
    it('function in filter in order by', () => {
      let query = cds.ql`
        SELECT ID
          from bookshop.Books as Books
          order by coAuthorUnmanaged[not (calculateName(ID) = 'King')].name
      `
      let expected = cds.ql`
        SELECT Books.ID from bookshop.Books as Books
          left join bookshop.Authors as coAuthorUnmanaged
            on coAuthorUnmanaged.ID = Books.coAuthor_ID_unmanaged and not (calculateName(coAuthorUnmanaged.ID) = 'King')
          order by coAuthorUnmanaged.name
      `

      let result = cqn4sql(query, model)
      expect(result).to.deep.equal(expected)
    })
    it('function in filter along path traversal', () => {
      // the `not` in front of `(name = 'King')` makes it an xpr
      // --> make sure we cover this path and prepend aliases
      let query = cds.ql`
        SELECT
            ID,
            coAuthorUnmanaged[not (calculateName(ID) = 'King')].name
          from bookshop.Books as Books
      `
      let expected = cds.ql`
        SELECT
            Books.ID,
            coAuthorUnmanaged.name as coAuthorUnmanaged_name
          from bookshop.Books as Books
          left join bookshop.Authors as coAuthorUnmanaged
            on coAuthorUnmanaged.ID = Books.coAuthor_ID_unmanaged and not (calculateName(coAuthorUnmanaged.ID) = 'King')
      `

      let result = cqn4sql(query, model)
      expect(result).to.deep.equal(expected)
    })

    it('refs in function args in on condition are aliased', () => {
      let query = cds.ql`
        SELECT
          ID,
          iSimilar { name }
        from bookshop.Posts as Posts `

      const expected = cds.ql`
        SELECT
          Posts.ID,
          (
            SELECT from bookshop.Posts as $i {
              $i.name
            }
            where UPPER(Posts.name) = UPPER($i.name)
          ) as iSimilar
        from bookshop.Posts as Posts`

      let result = cqn4sql(query, model)
      expect(JSON.parse(JSON.stringify(result))).to.deep.equal(expected)
    })
    it('refs in nested function args in on condition are aliased', () => {
      let query = cds.ql`
        SELECT
          ID,
          iSimilarNested { name }
        from bookshop.Posts as Posts`

      const expected = cds.ql`
        SELECT
          Posts.ID,
          (
            SELECT from bookshop.Posts as $i {
              $i.name
            }
            where UPPER($i.name) = UPPER(LOWER(UPPER(Posts.name)), Posts.name)
          ) as iSimilarNested
        from bookshop.Posts as Posts`

      let result = cqn4sql(query, model)
      expect(JSON.parse(JSON.stringify(result))).to.deep.equal(expected)
    })
  })

  describe('replace $self references', () => {
    it('escaped identifier does not hurt', () => {
      let query = cqn4sql(
        cds.ql`
      SELECT FROM bookshop.Books as ![FROM]
      {
        ![FROM].title as group,
      }
      where $self.group = 'foo'
      group by $self.group
      having $self.group = 'foo'
      order by $self.group
      `,
        model,
      )
      expect(query).to.deep.equal(cds.ql`
      SELECT from bookshop.Books as ![FROM]
      {
        ![FROM].title as group,
      }
      where ![FROM].title = 'foo'
      group by ![FROM].title
      having ![FROM].title = 'foo'
      order by ![FROM].title
      `)
    })
    it('refer to other query element', () => {
      const q = cds.ql`SELECT from bookshop.Books as Books {
      Books.title,
      title as title2,
      dedication as struct,
      1 + 1 as expression,
      42 as value,

      $self.dedication2 as dedication3,
      $self.struct.text as dedication,
      $self.dedication as dedication2,
      $self.expression as selfXpr,
      $self.value as selfVal,
    }`
      const transformed = cqn4sql(q, model)

      expect(JSON.parse(JSON.stringify(transformed))).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books {
      Books.title,
      Books.title as title2,
      Books.dedication_addressee_ID as struct_addressee_ID,
      Books.dedication_text as struct_text,
      Books.dedication_sub_foo as struct_sub_foo,
      Books.dedication_dedication as struct_dedication,
      1 + 1 as expression,
      42 as value,

      Books.dedication_text as dedication3,
      Books.dedication_text as dedication,
      Books.dedication_text as dedication2,
      1 + 1 as selfXpr,
      42 as selfVal
    }`)
    })
    it('late replace join relevant paths', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Authors as Authors {
            Authors.name as author,
            $self.book as dollarSelfBook,
            books.title as book,
          } group by $self.book
         `,
        model,
      )
      expect(query).to.deep.equal(
        cds.ql`SELECT from bookshop.Authors as Authors left join bookshop.Books as books on books.author_ID = Authors.ID {
          Authors.name as author,
          books.title as dollarSelfBook,
          books.title as book
        } group by books.title
       `,
      )
    })
    it('in aggregation', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Authors as Authors {
            name as author,
            1+1 as xpr,
            years_between(dateOfBirth, dateOfDeath) as age
          }
          group by $self.author, $self.xpr
          order by $self.author, $self.xpr
         `,
        model,
      )
      expect(query).to.deep.equal(
        cds.ql`SELECT from bookshop.Authors as Authors {
          Authors.name as author,
          1+1 as xpr,
          years_between(Authors.dateOfBirth, Authors.dateOfDeath) as age
        }
        group by Authors.name, 1+1
        order by Authors.name, 1+1
       `,
      )
    })
    it('in having', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Authors {
            name as author,
            1+1 as xpr,
          }
          having $self.xpr = 2
         `,
        model,
      )
      expect(query).to.deep.equal(
        cds.ql`SELECT from bookshop.Authors as $A {
          $A.name as author,
          1+1 as xpr,
        }
        having (1+1) = 2
       `,
      )
    })
    it('in where', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Authors {
            name as author,
            1+1 as xpr,
          }
          where 2 / $self.xpr = 1
         `,
        model,
      )
      expect(query).to.deep.equal(
        cds.ql`SELECT from bookshop.Authors as $A {
          $A.name as author,
          1+1 as xpr,
        }
        where 2 / (1+1) = 1
       `,
      )
    })
    it('refer to my own column in function expression', () => {
      const q = cds.ql`
        SELECT from bookshop.Books as Books {
          cast('2007-07-07' as Date) as twoLeapYearsEarlier,
          cast('2013-07-06' as Date) as twoLeapYearsLater,
          months_between($self.twoLeapYearsEarlier, $self.twoLeapYearsLater)
        }`
      const transformed = cqn4sql(q, model)
      const expectation = cds.ql`
        SELECT from bookshop.Books as Books {
          cast('2007-07-07' as cds.Date) as twoLeapYearsEarlier,
          cast('2013-07-06' as cds.Date) as twoLeapYearsLater,
          months_between(cast('2007-07-07' as cds.Date), cast('2007-07-06' as cds.Date)) as months_between
        }`
      // cast expression inside argument is parsed without surrounding "xpr"
      // hence we need to adjust the expectation
      expectation.SELECT.columns[2].args = [
        { xpr: expectation.SELECT.columns[0].xpr },
        { xpr: expectation.SELECT.columns[1].xpr },
      ]

      expect(JSON.parse(JSON.stringify(transformed))).to.deep.equal(expectation)
    })
    it('refer to my own column in calc expression', () => {
      const q = cds.ql`
        SELECT from bookshop.Books as Books {
          (cast('2007-07-07' as Date) + 1) as twoLeapYearsEarlier,
          (cast('2013-07-06' as Date) + 1) as twoLeapYearsLater,
          $self.twoLeapYearsEarlier +  months_between($self.twoLeapYearsEarlier + 15) as calc
        }`
      const transformed = cqn4sql(q, model)
      const expectation = cds.ql`
        SELECT from bookshop.Books as Books {
          (cast('2007-07-07' as cds.Date) + 1) as twoLeapYearsEarlier,
          (cast('2013-07-06' as cds.Date) + 1) as twoLeapYearsLater,
          (cast('2007-07-07' as cds.Date) + 1) + months_between((cast('2007-07-07' as cds.Date) + 1) + 15) as calc
        }`
      expect(JSON.parse(JSON.stringify(transformed))).to.deep.equal(expectation)
    })
  })

  describe('in ORDER BY', () => {
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
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books as Books { ID, ID as stock, ID as x }
        order by ID, stock, Books.stock, price, x`,
        model,
      )
      expect(query).to.deep
        .equal(cds.ql`SELECT from bookshop.Books as Books { Books.ID, Books.ID as stock, Books.ID as x }
        order by ID, stock, Books.stock, Books.price, x`)
    })

    it('prefers to resolve name in ORDER BY as select item (1)', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID as Books } ORDER BY Books`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books { Books.ID as Books } ORDER BY Books`)
    })

    it('prefers to resolve name in ORDER BY as select item (2)', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID as Books } ORDER BY Books.price`, model)).to.throw(
        /"price" not found in "Books"/,
      )
    })

    it('respects sort property also for expressions/functions', () => {
      const original = cds.ql`SELECT from (
                                select from bookshop.Books as Books { ID as Books } ORDER BY Books desc, sum(1+1) asc
                            ) as sub ORDER BY Books asc, 1+1 asc`

      const expected = cds.ql`SELECT sub.Books from (
                                    select from bookshop.Books as Books { Books.ID as Books } order by Books desc, sum(1+1) asc
                                ) as sub ORDER BY Books asc, 1+1 asc`

      let transformed = cqn4sql(original, model)

      expect(transformed).to.deep.equal(expected)
    })

    it('resolves single name in ORDER BY as data source element even if it equals table alias', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Books as stock { ID } ORDER BY stock`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as stock { stock.ID } ORDER BY stock.stock`)
    })

    it('for localized sorting, we must append the table alias for column refs', () => {
      // as down the line we always use collation expressions for localized sorting
      // we must prepend the table alias.
      // The simple reference will be wrapped in the expression and hence, expression name resolution rules kick in
      // see also https://github.com/cap-js/cds-dbs/issues/543
      const query = SELECT.localized
        .from('bookshop.Books')
        .alias('Books')
        .columns('title', 'title as foo', 'author.name as author')
        .orderBy('title', 'foo')
      let res = cqn4sql(query, model)
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(cds.ql`
      SELECT from bookshop.Books as Books
      left join bookshop.Authors as author on author.ID = Books.author_ID
      {
        Books.title,
        Books.title as foo,
        author.name as author
      }
      ORDER BY Books.title, Books.title`)
    })
    it('prepend artificial table alias if we select from anonymous subquery', async () => {
      const subquery = SELECT.localized.from('bookshop.SimpleBook').orderBy('title')
      const query = SELECT.localized.columns('ID', 'title', 'author').from(subquery).orderBy('title').groupBy('title')

      query.SELECT.count = true

      const res = cqn4sql(query, model)

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
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(expected)
    })
    it('same as above but descriptors like "asc", "desc" etc. must be kept', () => {
      const query = cds.ql`SELECT from bookshop.Books as Books {
        title,
        title as foo,
        author.name as author
      } order by title asc nulls first, foo desc nulls last`
      query.SELECT.localized = true
      let res = cqn4sql(query, model)
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(cds.ql`
      SELECT from bookshop.Books as Books
      left join bookshop.Authors as author on author.ID = Books.author_ID
      {
        Books.title,
        Books.title as foo,
        author.name as author
      }
      ORDER BY Books.title asc nulls first, Books.title desc nulls last`)
    })
    it('for localized sorting, replace string expression', () => {
      const query = CQL(`SELECT from bookshop.Books {
        'simple string' as foo: cds.String,
        substring('simple string') as bar: cds.String,
        'simple' || 'string' as baz: cds.String,
        author.name as author
      } order by foo, bar, baz`)
      query.SELECT.localized = true
      let res = cqn4sql(query, model)
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(cds.ql`
      SELECT from bookshop.Books as $B
      left join bookshop.Authors as author on author.ID = $B.author_ID
      {
        'simple string' as foo: cds.String,
        substring('simple string') as bar: cds.String,
        'simple' || 'string' as baz: cds.String,
        author.name as author
      }
      ORDER BY 'simple string', substring('simple string'), 'simple' || 'string'`)
    })

    it('supports ORDER BY clause with expressions', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books as Books { ID, ID as stock, ID as x }
        order by ID + stock + Books.stock + price, stock, x`,
        model,
      )
      expect(query).to.deep
        .equal(cds.ql`SELECT from bookshop.Books as Books { Books.ID, Books.ID as stock, Books.ID as x  }
        order by Books.ID + Books.stock + Books.stock + Books.price, stock, x`)
    })

    it('fails for select items in expressions in ORDER BY', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID, ID as x } order by ID + x`, model)).to.throw(
        /"x" not found in the elements of "bookshop.Books"/,
      )
    })
    it('should be possible to address alias of function', () => {
      let input = cds.ql`SELECT from bookshop.Books { func() as bubu } order by bubu`
      let query = cqn4sql(input, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as $B { func() as bubu } order by bubu`)
    })
    it('anonymous function gets proper alias', () => {
      let input = cds.ql`SELECT from bookshop.Books { func() }`
      let query = cqn4sql(input, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as $B { func() as func }`)
    })
    it('anonymous function gets proper alias and can be addressed in order by', () => {
      let input = cds.ql`SELECT from bookshop.Books { func() } order by func`
      let query = cqn4sql(input, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as $B { func() as func } order by func`)
    })

    it('do not try to resolve ref in columns if columns consists of star', () => {
      let input = cds.ql`SELECT from bookshop.SimpleBook { * } order by author.name`
      let query = cqn4sql(input, model)
      const expected = cds.ql`
      SELECT from bookshop.SimpleBook as $S
      left join bookshop.Authors as author on author.ID = $S.author_ID
      {
        $S.ID,
        $S.title,
        $S.author_ID
      } order by author.name`
      expect(query).to.deep.equal(expected)
    })
    // doesnt work, can't join with the query source itself
    it.skip('same as above but author is explicit column', () => {
      let input = cds.ql`SELECT from bookshop.SimpleBook { *, author } order by author.name`
      let query = cqn4sql(input, model)
      const expected = cds.ql`SELECT from bookshop.SimpleBook as SimpleBook left join bookshop.Authors as author on author.ID = SimpleBook.author_ID
      { SimpleBook.ID, SimpleBook.title, SimpleBook.author_ID } order by author.name`
      expect(query).to.deep.equal(expected)
    })
  })

  describe('replace usage of implicit aliases in subqueries', () => {
    it('in columns', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books {
                  ID,
                  (
                    SELECT from bookshop.Books {
                      $B.ID,
                    } where $B.ID = 1
                  ) as sub
                } where $B.ID = 1
                `,
        model,
      )
      expect(query).to.deep.equal(
        cds.ql`SELECT from bookshop.Books as $B {
              $B.ID,
              (
                SELECT from bookshop.Books as $B2 {
                  $B2.ID,
                } where $B2.ID = 1
              ) as sub
            } where $B.ID = 1`,
      )
    })
    it('in a scoped subquery, always assign unique subquery aliases', () => {
      const query = cds.ql`SELECT ID from bookshop.Item where exists (select ID from bookshop.Item:Item)`
      const res = cqn4sql(query, model)
      const expected = cds.ql`
      SELECT $I.ID from bookshop.Item as $I where exists (
        SELECT $I2.ID from bookshop.Item as $I2 where exists (
          SELECT 1 from bookshop.Item as $I3 where $I3.Item_ID = $I2.ID
        )
      )
      `
      expect(res).to.deep.eql(expected)
    })
    it('in expand subquery', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books {
                  ID,
                  (
                    SELECT from bookshop.Books {
                      $B.ID,
                      $B.author {
                        name
                      },
                    } where $B.author.dateOfBirth >= '01-01-1969'
                  ) as sub
                } where $B.ID = 1
                `,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(
        cds.ql`SELECT from bookshop.Books as $B {
              $B.ID,
              (
                SELECT from bookshop.Books as $B2
                  left join bookshop.Authors as author on author.ID = $B2.author_ID
                {
                  $B2.ID,
                  (
                    SELECT $a.name from bookshop.Authors as $a where $B2.author_ID = $a.ID
                  ) as author
                } where author.dateOfBirth >= '01-01-1969'
              ) as sub
            } where $B.ID = 1`,
      )
    })
    it('in join relevant columns', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books {
                  ID,
                  (
                    SELECT from bookshop.Books {
                      $B.ID,
                      $B.author.name,
                    } where $B.author.dateOfBirth >= '01-01-1969'
                  ) as sub
                } where $B.ID = 1
                `,
        model,
      )
      expect(query).to.deep.equal(
        cds.ql`SELECT from bookshop.Books as $B {
              $B.ID,
              (
                SELECT from bookshop.Books as $B2
                  left join bookshop.Authors as author on author.ID = $B2.author_ID
                {
                  $B2.ID,
                  author.name as author_name,
                } where author.dateOfBirth >= '01-01-1969'
              ) as sub
            } where $B.ID = 1`,
      )
    })
    it('in group by and order by', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books {
                  ID,
                  (
                    SELECT from bookshop.Books {
                      $B.ID,
                    }
                    group by $B.title
                    order by $B.ID
                  ) as sub
                } where $B.ID = 1
                `,
        model,
      )
      expect(query).to.deep.equal(
        cds.ql`SELECT from bookshop.Books as $B {
              $B.ID,
              (
                SELECT from bookshop.Books as $B2 {
                  $B2.ID,
                }
                group by $B2.title
                order by $B2.ID
              ) as sub
            } where $B.ID = 1`,
      )
    })
  })

  describe('in expressions', () => {
    it('expressions and functions in select list', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books {
            stock * price as foo,
            power(price, stock) as bar,
            stock * power(sin(2*price),
            2*(stock+3*stock)) as nested,
            2 as two
          }`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as $B {
            $B.stock * $B.price as foo,
            power($B.price, $B.stock) as bar,
            $B.stock * power(sin(2*$B.price), 2*($B.stock+3*$B.stock)) as nested,
            2 as two
          }`)
    })

    it('expressions and functions in WHERE', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books { ID }
            where stock * price < power(price, stock) or stock * power(sin(2*price), 2*(stock+3*stock)) < 7`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as $B { $B.ID }
            where $B.stock * $B.price < power($B.price, $B.stock) or $B.stock * power(sin(2*$B.price), 2*($B.stock+3*$B.stock)) < 7`)
    })

    it('expressions and functions in GROUP BY/HAVING', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books { ID }
            group by stock * price, power(price, stock), stock * power(sin(2*price), 2*(stock+3*stock))
            having stock * price < power(price, stock) or stock * power(sin(2*price), 2*(stock+3*stock)) < 7`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as $B { $B.ID }
            group by $B.stock * $B.price, power($B.price, $B.stock), $B.stock * power(sin(2*$B.price), 2*($B.stock+3*$B.stock))
            having $B.stock * $B.price < power($B.price, $B.stock) or $B.stock * power(sin(2*$B.price), 2*($B.stock+3*$B.stock)) < 7`)
    })
  })

  describe('in subqueries', () => {
    it('respects aliases of outer queries and does not shadow them', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books {
            ID,
            (SELECT from bookshop.Books {
              author,
              (
                SELECT from bookshop.Books {
                  author
              }) as bar
            }) as foo
          }`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(cds.ql`
        SELECT from bookshop.Books as $B {
            $B.ID,
            (SELECT from bookshop.Books as $B2 { $B2.author_ID,
              (SELECT from bookshop.Books as $B3 { $B3.author_ID }) as bar
            }) as foo
          }`)
    })
    it('respects aliases of outer queries and does not shadow them mix of regular subqueries and expands', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books {
            ID,
            (SELECT from bookshop.Books {
              author,
              (
                SELECT from bookshop.Books {
                  author {
                    books { ID }
                  }
              }) as bar
            }) as foo
          }`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(cds.ql`
        SELECT from bookshop.Books as $B {
            $B.ID,
            (SELECT from bookshop.Books as $B2 { $B2.author_ID,
              (SELECT from bookshop.Books as $B3 {
                (SELECT from bookshop.Authors as $a {
                  (SELECT from bookshop.Books as $b4 {
                    $b4.ID
                  } where $a.ID = $b4.author_ID) as books
                } where $B3.author_ID = $a.ID) as author
               }) as bar
            }) as foo
          }`)
    })
    // explicit alias for FROM subquery is mandatory
    // could maybe be relaxed later
    it('applies the same alias handling in subqueries in FROM', () => {
      let query = cqn4sql(
        cds.ql`SELECT from (SELECT from bookshop.Books { ID, stock }) as Books { ID, Books.stock }`,
        model,
      )
      expect(query).to.deep.equal(
        cds.ql`SELECT from (SELECT from bookshop.Books as $B { $B.ID, $B.stock }) as Books { Books.ID, Books.stock }`,
      )
    })
    it('explicit alias for FROM subquery', () => {
      let query = cqn4sql(
        cds.ql`SELECT from (
          SELECT from bookshop.Books as Books {
            ID, Books.stock, Books.dedication
          }) as B { ID, B.stock, B.dedication }`,
        model,
      )
      expect(query).to.deep.equal(
        cds.ql`SELECT from (
              SELECT from bookshop.Books as Books {
                Books.ID,
                Books.stock,
                Books.dedication_addressee_ID,
                Books.dedication_text,
                Books.dedication_sub_foo,
                Books.dedication_dedication
              }
            ) as B {
              B.ID,
              B.stock,
              B.dedication_addressee_ID,
              B.dedication_text,
              B.dedication_sub_foo,
              B.dedication_dedication
            }`,
      )
    })
    it('wildcard expansion of subquery in from ignores assocs', () => {
      let query = cqn4sql(cds.ql`SELECT from ( SELECT from bookshop.Orders as Orders) as O`, model)
      expect(query).to.deep.equal(
        cds.ql`SELECT from (
          SELECT from bookshop.Orders as Orders {
            Orders.ID,
          }
        ) as O {
          O.ID,
        }`,
      )
    })
    it('prepends unique alias for function args or expressions on top of anonymous subquery', () => {
      let query = cqn4sql(
        cds.ql`SELECT from ( SELECT from bookshop.Orders as Orders ) {
          sum(ID) as foo,
          ID + 42 as anotherFoo
        }`,
        model,
      )
      expect(query).to.deep.equal(
        cds.ql`SELECT from (
          SELECT from bookshop.Orders as Orders {
            Orders.ID
          }
        ) as __select__ {
          sum(__select__.ID) as foo,
          __select__.ID + 42 as anotherFoo
        }`,
      )
    })
    it('wildcard expansion for subquery in FROM', () => {
      // REVISIT: order not stable, move "ID" to top of columns in subquery in from
      let query = cqn4sql(
        cds.ql`SELECT from (
          SELECT from bookshop.Books as Books {
            sum(stock) as totalStock,
            ID,
            Books.stock,
            Books.dedication,
            Books.author
          }
         ) as B`,
        model,
      )
      expect(query).to.deep.equal(
        cds.ql`SELECT from (
          SELECT from bookshop.Books as Books {
            sum(Books.stock) as totalStock,
            Books.ID,
            Books.stock,
            Books.dedication_addressee_ID,
            Books.dedication_text,
            Books.dedication_sub_foo,
            Books.dedication_dedication,
            Books.author_ID
          }
        ) as B {
          B.totalStock,
          B.ID,
          B.stock,
          B.dedication_addressee_ID,
          B.dedication_text,
          B.dedication_sub_foo,
          B.dedication_dedication,
          B.author_ID
        }`,
      )
    })

    it('cannot access table name of FROM subquery in outer query', () => {
      expect(() =>
        cqn4sql(cds.ql`SELECT from (SELECT from bookshop.Books as Books { ID, Books.stock }) as B { ID, Books.stock }`, model),
      ).to.throw(/"Books" not found in the elements of "B"/)
    })

    it('expose column of inner query in outer query', () => {
      let query = cqn4sql(
        cds.ql`SELECT from (SELECT from bookshop.Books as Books { ID, Books.stock as Books }) as B { ID, B.Books }`,
        model,
      )
      expect(query).to.deep.equal(
        cds.ql`SELECT from (SELECT from bookshop.Books as Books { Books.ID, Books.stock as Books }) as B { B.ID, B.Books }`,
      )
    })
    it('preserves explicit table alias in FROM subquery', () => {
      let query = cqn4sql(
        cds.ql`SELECT from (SELECT from bookshop.Books as inner { ID, inner.stock }) as Books { ID, Books.stock }`,
        model,
      )
      expect(query).to.deep.equal(
        cds.ql`SELECT from (SELECT from bookshop.Books as inner { inner.ID, inner.stock }) as Books { Books.ID, Books.stock }`,
      )
    })

    it('applies the same alias handling in value subqueries', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Books { ID, (SELECT from bookshop.Books { ID }) as foo }`, model)
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(
        cds.ql`SELECT from bookshop.Books as $B {
              $B.ID,
              (SELECT from bookshop.Books as $B2 { $B2.ID } ) as foo
            }`,
      )
    })

    it('supports correlated value subquery in select list', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books as Books { ID, (SELECT from bookshop.Books as Q { ID } where Q.ID = Books.ID) as foo }`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(
        cds.ql`SELECT from bookshop.Books as Books { Books.ID, (SELECT from bookshop.Books as Q { Q.ID } where Q.ID = Books.ID) as foo }`,
      )
    })

    it('supports correlated value subquery in select list, explicit table alias for outer query', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books as O { ID, (SELECT from bookshop.Books as Q { ID } where Q.ID = O.ID) as foo }`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(
        cds.ql`SELECT from bookshop.Books as O { O.ID, (SELECT from bookshop.Books as Q { Q.ID } where Q.ID = O.ID) as foo }`,
      )
    })

    it('in correlated subquery, allows access to fields of inner query without explicit table alias', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books as Books { ID, (SELECT from bookshop.Books as Q { ID } where ID = Books.ID) as foo }`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(
        cds.ql`SELECT from bookshop.Books as Books { Books.ID, (SELECT from bookshop.Books as Q { Q.ID } where Q.ID = Books.ID) as foo }`,
      )
    })

    // Although SQL allows this, in a correlated subquery we purposely deny access to fields of
    // outer query w/o table alias. Reasoning:
    // - model extensions: protection against changing semantics of the query when adding
    //   elements to involved entities later
    // - unlike in SQL, we cannot syntactically tell whether foo in foo.bar is a table alias or a structure/assoc
    //   -> new rules for precedence of table alias/elements found in outer queries would be necessary
    it('in correlated subquery, denies access to fields of outer query without explicit table alias', () => {
      expect(() =>
        cqn4sql(
          cds.ql`SELECT from bookshop.Books { ID, (SELECT from bookshop.Authors { ID } where name = title) as foo }`,
          model,
        ),
      ).to.throw(/"title" not found in the elements of "bookshop.Authors"/)
    })

    it('in nested correlated subqueries, allows access to fields of all outer queries', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books as B {
              (SELECT from bookshop.Authors as A {
                (SELECT from bookshop.Genres as G { ID } where descr = A.name and descr = B.title) as foo
              } where A.name = B.title) as foo
            }`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(
        cds.ql`SELECT from bookshop.Books as B {
              (SELECT from bookshop.Authors as A {
                (SELECT from bookshop.Genres as G { G.ID } where G.descr = A.name and G.descr = B.title) as foo
              } where A.name = B.title) as foo
            }`,
      )
    })

    it('in nested correlated subqueries, table alias may be shadowed', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books as B {
              (SELECT from bookshop.Authors as A {
                (SELECT from bookshop.Genres as B { ID } where A.name = B.descr) as foo
              } where A.name = B.title) as foo
            }`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(
        cds.ql`SELECT from bookshop.Books as B {
              (SELECT from bookshop.Authors as A {
                (SELECT from bookshop.Genres as B { B.ID } where A.name = B.descr) as foo
              } where A.name = B.title) as foo
            }`,
      )
    })
    it('in nested correlated subqueries, table alias may be shadowed', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books as Books {
              (SELECT from bookshop.Authors as Authors {
                books.title
              } where name = Books.title) as foo
            }`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(
        cds.ql`SELECT from bookshop.Books as Books {
              (SELECT from bookshop.Authors as Authors
                  left join bookshop.Books as books2  on books2.author_ID = Authors.ID {
                books2.title as books_title
              } where Authors.name = Books.title) as foo
            }`,
      )
    })

    it('in nested correlated subqueries, table alias may be shadowed (2)', () => {
      expect(() =>
        cqn4sql(
          cds.ql`SELECT from bookshop.Books as B {
            (SELECT from bookshop.Authors as A {
              (SELECT from bookshop.Genres as B { ID } where A.name = B.title) as foo
            } where A.name = B.title) as foo
          }`,
          model,
        ),
      ).to.throw(/"title" not found in "bookshop.Genres"/)
    })

    it('handles ref in list', () => {
      const query = SELECT.from({
        ref: [
          {
            id: 'bookshop.Books',
            where: [
              { list: [{ ref: ['dedication', 'addressee', 'ID'] }] },
              'in',
              cds.ql`SELECT ID from bookshop.Books where ID = 5`,
            ],
          },
        ],
      }).columns('ID')

      const expected = SELECT.from('bookshop.Books as $B')
        .columns('$B.ID')
        .where([
          {
            list: [{ ref: ['$B', 'dedication_addressee_ID'] }],
          },
          'in',
          cds.ql`SELECT $B2.ID from bookshop.Books as $B2 where $B2.ID = 5`,
        ])

      const res = cqn4sql(query, model)
      expect(res).to.deep.equal(expected)
    })

    it('handles ref in list of from with scoped query', () => {
      const query = SELECT.from({
        ref: [
          {
            id: 'bookshop.Books',
            where: [
              { list: [{ ref: ['dedication', 'addressee', 'ID'] }] },
              'in',
              cds.ql`SELECT Books.ID from bookshop.Books as Books where Books.ID = 5`,
            ],
          },
          'coAuthorUnmanaged',
        ],
        as: 'coAuthorUnmanaged',
      }).columns('ID')

      const expected = SELECT.from('bookshop.Authors as coAuthorUnmanaged').columns('coAuthorUnmanaged.ID').where(`
          exists (
            SELECT 1 from bookshop.Books as $B where coAuthorUnmanaged.ID = $B.coAuthor_ID_unmanaged
          )
        `)

      const list = [
        {
          list: [{ ref: ['$B', 'dedication_addressee_ID'] }],
        },
        'in',
        cds.ql`SELECT Books.ID from bookshop.Books as Books where Books.ID = 5`,
      ]

      expected.SELECT.where[1].SELECT.where.push('and', ...list)

      const res = cqn4sql(query, model)
      expect(res).to.deep.equal(expected)
    })

    it('handles value subquery in WHERE', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books as Books { ID }
            WHERE (SELECT from bookshop.Books as qInWhere { ID }) = 5`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books { Books.ID }
            WHERE (SELECT from bookshop.Books as qInWhere { qInWhere.ID }) = 5`)
    })

    it('handles correlated value subquery in WHERE', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books as Books { ID }
            WHERE (SELECT from bookshop.Books as qInWhere { ID } where ID = Books.ID) = 5`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books { Books.ID }
            WHERE (SELECT from bookshop.Books as qInWhere { qInWhere.ID } where qInWhere.ID = Books.ID) = 5`)
    })

    it('handles EXISTS subquery in WHERE', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Authors as Authors { ID } WHERE exists (
            SELECT 1 from bookshop.Books as Books where ID = Authors.ID
            )`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep
        .equal(cds.ql`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE exists (
            SELECT 1 from bookshop.Books as Books where Books.ID = Authors.ID
          )`)
    })

    it('handles EXISTS subquery in WHERE, explicit table alias', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Authors as Books { ID } WHERE exists (
            SELECT 1 from bookshop.Books as Authors where ID > Books.ID
            )`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep
        .equal(cds.ql`SELECT from bookshop.Authors as Books { Books.ID } WHERE exists (
            SELECT 1 from bookshop.Books as Authors where Authors.ID > Books.ID
          )`)
    })

    it('handles the select list of an exists subquery like any other select list', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Authors as Authors { ID } WHERE exists (
            SELECT ID, stock, price from bookshop.Books as Books where ID = Authors.ID
            )`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep
        .equal(cds.ql`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE exists (
            SELECT Books.ID, Books.stock, Books.price from bookshop.Books as Books where Books.ID = Authors.ID
          )`)
    })

    it('handles WHERE inside the sub query with a priority of the external query over the association inside the entity', () => {
      const cql = `SELECT from bookshop.Authors as author { ID, (SELECT from bookshop.Books as books { ID } WHERE books.author.ID = author.ID) as books}`
      const expectation = `SELECT from bookshop.Authors as author { author.ID, (SELECT from bookshop.Books as books { books.ID } WHERE books.author_ID = author.ID) as books}`

      const query = cqn4sql(CQL(cql), model)

      // REVISIT: calling cqn4sql with the results throws
      // "Cannot redefine property: element"
      const resultCopy = JSON.parse(JSON.stringify(query))
      expect(resultCopy).to.deep.equal(CQL(expectation))

      // Ensure that it throws when not using the nodejs model
      let error
      try {
        const resultCopy = JSON.parse(JSON.stringify(query))
        cqn4sql(resultCopy, model)
      } catch (e) {
        error = e
      }
      expect(error.message).to.match(/author_ID/)

      const nodeModel = cds.compile.for.nodejs(JSON.parse(JSON.stringify(model)))
      const repeat = cqn4sql(resultCopy, nodeModel)

      // Ensure sure that the where clause does not change
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(JSON.parse(JSON.stringify(repeat)))
    })
  })
})
