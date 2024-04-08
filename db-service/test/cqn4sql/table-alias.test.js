'use strict'

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds/lib')
const { expect } = cds.test
describe('table alias access', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  describe('in columns', () => {
    // For the time being, we always add a table alias for field accesses.
    // On DB, the table name is bookshop_Books rather than Books
    // -> if Books is used as table alias, we need to explicitly define this alias
    it('makes implicit table alias explicit and uses it for access', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Books { ID }`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID }`)
    })

    it('omits alias for anonymous query which selects from other query', () => {
      let query = cqn4sql(CQL`SELECT from (SELECT from bookshop.Books { ID } )`, model)
      expect(query).to.deep.equal(CQL`SELECT from (SELECT from bookshop.Books as Books { Books.ID }) { ID }`)
    })

    it('preserves table alias at field access', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Books { Books.ID }`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID }`)
    })

    it('handles field access with and without table alias', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Books { ID, Books.stock }`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID, Books.stock }`)
    })

    it('supports user defined table alias', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Books as A { A.ID, stock }`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as A { A.ID, A.stock }`)
    })

    it('user defined table alias equals field name', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Books as stock { stock.ID, stock, stock.stock as s2 }`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as stock { stock.ID, stock.stock, stock.stock as s2 }`)
    })

    it('supports scoped entity names', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Books.twin { ID }`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books.twin as twin { twin.ID }`)
    })
  })

  describe('in WHERE, GROUP BY, HAVING', () => {
    it('WHERE with implicit table alias', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Books { ID } WHERE ID = 1 and Books.stock <> 1`, model)
      expect(query).to.deep.equal(
        CQL`SELECT from bookshop.Books as Books { Books.ID } WHERE Books.ID = 1 and Books.stock <> 1`,
      )
    })

    it('treat ref with param: true as value', () => {
      const query = {
        SELECT: {
          columns: [{ ref: ['ID'] }, { ref: ['?'], param: true, as: 'discount' }],
          from: { ref: ['bookshop.Books'] },
          where: [{ ref: ['ID'] }, '=', { ref: ['?'], param: true }],
        },
      }
      expect(cqn4sql(query, model)).to.deep.equal(
        CQL`SELECT Books.ID, ? as discount from bookshop.Books as Books WHERE Books.ID = ?`,
      )
    })

    it('WHERE with explicit table alias', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Books as Bar { ID } WHERE ID = 1 and Bar.stock <> 1`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Bar { Bar.ID } WHERE Bar.ID = 1 and Bar.stock <> 1`)
    })

    it('WHERE with explicit table alias that equals field name', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Books as stock { ID } WHERE stock.ID = 1 and stock <> 1`, model)
      expect(query).to.deep.equal(
        CQL`SELECT from bookshop.Books as stock { stock.ID } WHERE stock.ID = 1 and stock.stock <> 1`,
      )
    })

    it('allows access to and prepends table alias in GROUP BY/HAVING clause', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books { stock }
            group by stock, Books.title having stock > 5 and Books.title = 'foo'`,
        model,
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.stock }
            group by Books.stock, Books.title having Books.stock > 5 and Books.title = 'foo'`)
    })

    it('xpr in filter within where exists shortcut', () => {
      // the `not` in front of `(name = 'King')` makes it an xpr
      // --> make sure we cover this path and prepend aliases
      let query = CQL`
        SELECT ID
          from bookshop.Books
          where not exists coAuthorUnmanaged[not (name = 'King')]
          order by ID asc
      `
      let expected = CQL`
        SELECT Books.ID from bookshop.Books as Books
          where not exists (
            SELECT 1 from bookshop.Authors as coAuthorUnmanaged
              where coAuthorUnmanaged.ID = Books.coAuthor_ID_unmanaged and not (coAuthorUnmanaged.name = 'King')
          )
          order by ID asc
      `

      let result = cqn4sql(query, model)
      expect(result).to.deep.equal(expected)
    })

    it('xpr in filter in having', () => {
      // the `not` in front of `(name = 'King')` makes it an xpr
      // --> make sure we cover this path and prepend aliases
      let query = CQL`
        SELECT ID
          from bookshop.Books
          having coAuthorUnmanaged[not (name = 'King')].name
          order by ID asc
      `
      let expected = CQL`
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
      let query = CQL`
        SELECT ID
          from bookshop.Books
          group by coAuthorUnmanaged[not (name = 'King')].name
          order by ID asc
      `
      let expected = CQL`
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
      let query = CQL`
        SELECT ID
          from bookshop.Books
          order by coAuthorUnmanaged[not (name = 'King')].name
      `
      let expected = CQL`
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
      let query = CQL`
        SELECT ID
          from bookshop.Books
          order by coAuthorUnmanaged[not (calculateName(ID) = 'King')].name
      `
      let expected = CQL`
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
      let query = CQL`
        SELECT
            ID,
            coAuthorUnmanaged[not (calculateName(ID) = 'King')].name
          from bookshop.Books
      `
      let expected = CQL`
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
  })

  describe('replace $self references', () => {
    it('escaped identifier does not hurt', () => {
      let query = cqn4sql(
        CQL`
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
      expect(query).to.deep.equal(CQL`
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
      const q = CQL`SELECT from bookshop.Books {
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

      expect(JSON.parse(JSON.stringify(transformed))).to.deep.equal(CQL`SELECT from bookshop.Books as Books {
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
        CQL`SELECT from bookshop.Authors {
            Authors.name as author,
            $self.book as dollarSelfBook,
            books.title as book,
          } group by $self.book
         `,
        model,
      )
      expect(query).to.deep.equal(
        CQL`SELECT from bookshop.Authors as Authors left join bookshop.Books as books on books.author_ID = Authors.ID {
          Authors.name as author,
          books.title as dollarSelfBook,
          books.title as book
        } group by books.title
       `,
      )
    })
    it('in aggregation', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Authors {
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
        CQL`SELECT from bookshop.Authors as Authors {
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
        CQL`SELECT from bookshop.Authors {
            name as author,
            1+1 as xpr,
          }
          having $self.xpr = 2
         `,
        model,
      )
      expect(query).to.deep.equal(
        CQL`SELECT from bookshop.Authors as Authors {
          Authors.name as author,
          1+1 as xpr,
        }
        having (1+1) = 2
       `,
      )
    })
    it('in where', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Authors {
            name as author,
            1+1 as xpr,
          }
          where 2 / $self.xpr = 1
         `,
        model,
      )
      expect(query).to.deep.equal(
        CQL`SELECT from bookshop.Authors as Authors {
          Authors.name as author,
          1+1 as xpr,
        }
        where 2 / (1+1) = 1
       `,
      )
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
        CQL`SELECT from bookshop.Books { ID, ID as stock, ID as x }
        order by ID, stock, Books.stock, price, x`,
        model,
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID, Books.ID as stock, Books.ID as x }
        order by ID, stock, Books.stock, Books.price, x`)
    })

    it('prefers to resolve name in ORDER BY as select item (1)', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Books { ID as Books } ORDER BY Books`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID as Books } ORDER BY Books`)
    })

    it('prefers to resolve name in ORDER BY as select item (2)', () => {
      expect(() => cqn4sql(CQL`SELECT from bookshop.Books { ID as Books } ORDER BY Books.price`, model)).to.throw(
        /"price" not found in "Books"/,
      )
    })

    it('respects sort property also for expressions/functions', () => {
      const original = CQL`SELECT from (
                                select from bookshop.Books { ID as Books } ORDER BY Books desc, sum(1+1) asc
                            ) as sub ORDER BY Books asc, 1+1 asc`

      const expected = CQL`SELECT sub.Books from (
                                    select from bookshop.Books as Books { Books.ID as Books } order by Books desc, sum(1+1) asc
                                ) as sub ORDER BY Books asc, 1+1 asc`

      let transformed = cqn4sql(original, model)

      expect(transformed).to.deep.equal(expected)
    })

    it('resolves single name in ORDER BY as data source element even if it equals table alias', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Books as stock { ID } ORDER BY stock`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as stock { stock.ID } ORDER BY stock.stock`)
    })

    it('supports ORDER BY clause with expressions', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books { ID, ID as stock, ID as x }
        order by ID + stock + Books.stock + price, stock, x`,
        model,
      )
      expect(query).to.deep
        .equal(CQL`SELECT from bookshop.Books as Books { Books.ID, Books.ID as stock, Books.ID as x  }
        order by Books.ID + Books.stock + Books.stock + Books.price, stock, x`)
    })

    it('fails for select items in expressions in ORDER BY', () => {
      expect(() => cqn4sql(CQL`SELECT from bookshop.Books { ID, ID as x } order by ID + x`, model)).to.throw(
        /"x" not found in the elements of "bookshop.Books"/,
      )
    })
    it('should be possible to address alias of function', () => {
      let input = CQL`SELECT from bookshop.Books { func() as bubu } order by bubu`
      let query = cqn4sql(input, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { func() as bubu } order by bubu`)
    })
    it('anonymous function gets proper alias', () => {
      let input = CQL`SELECT from bookshop.Books { func() }`
      let query = cqn4sql(input, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { func() as func }`)
    })
    it('anonymous function gets proper alias and can be addressed in order by', () => {
      let input = CQL`SELECT from bookshop.Books { func() } order by func`
      let query = cqn4sql(input, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { func() as func } order by func`)
    })
  })

  describe('replace usage of implicit aliases in subqueries', () => {
    it('in columns', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books {
                  ID,
                  (
                    SELECT from bookshop.Books {
                      Books.ID,
                    } where Books.ID = 1
                  ) as sub
                } where Books.ID = 1
                `,
        model,
      )
      expect(query).to.deep.equal(
        CQL`SELECT from bookshop.Books as Books {
              Books.ID,
              (
                SELECT from bookshop.Books as Books2 {
                  Books2.ID,
                } where Books2.ID = 1
              ) as sub
            } where Books.ID = 1`,
      )
    })
    it('in a scoped subquery, always assign unique subquery aliases', () => {
      const query = CQL`SELECT ID from bookshop.Item where exists (select ID from bookshop.Item:item)`
      const res = cqn4sql(query, model)
      const expected = CQL`
      SELECT Item.ID from bookshop.Item as Item where exists (
        SELECT item2.ID from bookshop.Item as item2 where exists (
          SELECT 1 from bookshop.Item as Item3 where Item3.item_ID = item2.ID
        )
      )
      `
      expect(res).to.deep.eql(expected)
    })
    it('in expand subquery', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books {
                  ID,
                  (
                    SELECT from bookshop.Books {
                      Books.ID,
                      Books.author {
                        name
                      },
                    } where Books.author.dateOfBirth >= '01-01-1969'
                  ) as sub
                } where Books.ID = 1
                `,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(
        CQL`SELECT from bookshop.Books as Books {
              Books.ID,
              (
                SELECT from bookshop.Books as Books2
                  left join bookshop.Authors as author on author.ID = Books2.author_ID
                {
                  Books2.ID,
                  (
                    SELECT author2.name from bookshop.Authors as author2 where Books2.author_ID = author2.ID
                  ) as author
                } where author.dateOfBirth >= '01-01-1969'
              ) as sub
            } where Books.ID = 1`,
      )
    })
    it('in join relevant columns', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books {
                  ID,
                  (
                    SELECT from bookshop.Books {
                      Books.ID,
                      Books.author.name,
                    } where Books.author.dateOfBirth >= '01-01-1969'
                  ) as sub
                } where Books.ID = 1
                `,
        model,
      )
      expect(query).to.deep.equal(
        CQL`SELECT from bookshop.Books as Books {
              Books.ID,
              (
                SELECT from bookshop.Books as Books2
                  left join bookshop.Authors as author on author.ID = Books2.author_ID
                {
                  Books2.ID,
                  author.name as author_name,
                } where author.dateOfBirth >= '01-01-1969'
              ) as sub
            } where Books.ID = 1`,
      )
    })
    it('in group by and order by', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books {
                  ID,
                  (
                    SELECT from bookshop.Books {
                      Books.ID,
                    }
                    group by Books.title
                    order by Books.ID
                  ) as sub
                } where Books.ID = 1
                `,
        model,
      )
      expect(query).to.deep.equal(
        CQL`SELECT from bookshop.Books as Books {
              Books.ID,
              (
                SELECT from bookshop.Books as Books2 {
                  Books2.ID,
                }
                group by Books2.title
                order by Books2.ID
              ) as sub
            } where Books.ID = 1`,
      )
    })
  })

  describe('in expressions', () => {
    it('expressions and functions in select list', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books {
            stock * price as foo,
            power(price, stock) as bar,
            stock * power(sin(2*price),
            2*(stock+3*stock)) as nested,
            2 as two
          }`,
        model,
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books {
            Books.stock * Books.price as foo,
            power(Books.price, Books.stock) as bar,
            Books.stock * power(sin(2*Books.price), 2*(Books.stock+3*Books.stock)) as nested,
            2 as two
          }`)
    })

    it('expressions and functions in WHERE', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books { ID }
            where stock * price < power(price, stock) or stock * power(sin(2*price), 2*(stock+3*stock)) < 7`,
        model,
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID }
            where Books.stock * Books.price < power(Books.price, Books.stock) or Books.stock * power(sin(2*Books.price), 2*(Books.stock+3*Books.stock)) < 7`)
    })

    it('expressions and functions in GROUP BY/HAVING', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books { ID }
            group by stock * price, power(price, stock), stock * power(sin(2*price), 2*(stock+3*stock))
            having stock * price < power(price, stock) or stock * power(sin(2*price), 2*(stock+3*stock)) < 7`,
        model,
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID }
            group by Books.stock * Books.price, power(Books.price, Books.stock), Books.stock * power(sin(2*Books.price), 2*(Books.stock+3*Books.stock))
            having Books.stock * Books.price < power(Books.price, Books.stock) or Books.stock * power(sin(2*Books.price), 2*(Books.stock+3*Books.stock)) < 7`)
    })
  })

  describe('in subqueries', () => {
    it('respects aliases of outer queries and does not shadow them', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books {
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
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(CQL`SELECT from bookshop.Books as Books {
            Books.ID,
            (SELECT from bookshop.Books as Books2 { Books2.author_ID,
              (SELECT from bookshop.Books as Books3 { Books3.author_ID }) as bar
            }) as foo
          }`)
    })
    it('respects aliases of outer queries and does not shadow them mix of regular subqueries and expands', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books {
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
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(CQL`SELECT from bookshop.Books as Books {
            Books.ID,
            (SELECT from bookshop.Books as Books2 { Books2.author_ID,
              (SELECT from bookshop.Books as Books3 { 
                (SELECT from bookshop.Authors as author {
                  (SELECT from bookshop.Books as books4 {
                    books4.ID
                  } where author.ID = books4.author_ID) as books
                } where Books3.author_ID = author.ID) as author
               }) as bar
            }) as foo
          }`)
    })
    // explicit alias for FROM subquery is mandatory
    // could maybe be relaxed later
    it('applies the same alias handling in subqueries in FROM', () => {
      let query = cqn4sql(
        CQL`SELECT from (SELECT from bookshop.Books { ID, Books.stock }) as Books { ID, Books.stock }`,
        model,
      )
      expect(query).to.deep.equal(
        CQL`SELECT from (SELECT from bookshop.Books as Books2 { Books2.ID, Books2.stock }) as Books { Books.ID, Books.stock }`,
      )
    })
    it('explicit alias for FROM subquery', () => {
      let query = cqn4sql(
        CQL`SELECT from (
          SELECT from bookshop.Books {
            ID, Books.stock, Books.dedication
          }) as B { ID, B.stock, B.dedication }`,
        model,
      )
      expect(query).to.deep.equal(
        CQL`SELECT from (
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
      let query = cqn4sql(CQL`SELECT from ( SELECT from bookshop.Orders ) as O`, model)
      expect(query).to.deep.equal(
        CQL`SELECT from (
          SELECT from bookshop.Orders as Orders {
            Orders.ID,
          }
        ) as O {
          O.ID,
        }`,
      )
    })
    it('no alias for function args or expressions on top of anonymous subquery', () => {
      let query = cqn4sql(
        CQL`SELECT from ( SELECT from bookshop.Orders ) {
          sum(ID) as foo,
          ID + 42 as anotherFoo
        }`,
        model,
      )
      expect(query).to.deep.equal(
        CQL`SELECT from (
          SELECT from bookshop.Orders as Orders {
            Orders.ID
          }
        ) {
          sum(ID) as foo,
          ID + 42 as anotherFoo
        }`,
      )
    })
    it('wildcard expansion for subquery in FROM', () => {
      // REVISIT: order not stable, move "ID" to top of columns in subquery in from
      let query = cqn4sql(
        CQL`SELECT from (
          SELECT from bookshop.Books {
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
        CQL`SELECT from (
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
        cqn4sql(CQL`SELECT from (SELECT from bookshop.Books { ID, Books.stock }) as B { ID, Books.stock }`, model),
      ).to.throw(/"Books" not found in the elements of "B"/)
    })

    it('expose column of inner query in outer query', () => {
      let query = cqn4sql(
        CQL`SELECT from (SELECT from bookshop.Books { ID, Books.stock as Books }) as B { ID, Books }`,
        model,
      )
      expect(query).to.deep.equal(
        CQL`SELECT from (SELECT from bookshop.Books as Books { Books.ID, Books.stock as Books }) as B { B.ID, B.Books }`,
      )
    })
    it('preserves explicit table alias in FROM subquery', () => {
      let query = cqn4sql(
        CQL`SELECT from (SELECT from bookshop.Books as inner { ID, inner.stock }) as Books { ID, Books.stock }`,
        model,
      )
      expect(query).to.deep.equal(
        CQL`SELECT from (SELECT from bookshop.Books as inner { inner.ID, inner.stock }) as Books { Books.ID, Books.stock }`,
      )
    })

    it('applies the same alias handling in value subqueries', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Books { ID, (SELECT from bookshop.Books { ID }) as foo }`, model)
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(
        CQL`SELECT from bookshop.Books as Books {
              Books.ID,
              (SELECT from bookshop.Books as Books2 { Books2.ID } ) as foo
            }`,
      )
    })

    it('supports correlated value subquery in select list', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books { ID, (SELECT from bookshop.Books as Q { ID } where Q.ID = Books.ID) as foo }`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(
        CQL`SELECT from bookshop.Books as Books { Books.ID, (SELECT from bookshop.Books as Q { Q.ID } where Q.ID = Books.ID) as foo }`,
      )
    })

    it('supports correlated value subquery in select list, explicit table alias for outer query', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books as O { ID, (SELECT from bookshop.Books as Q { ID } where Q.ID = O.ID) as foo }`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(
        CQL`SELECT from bookshop.Books as O { O.ID, (SELECT from bookshop.Books as Q { Q.ID } where Q.ID = O.ID) as foo }`,
      )
    })

    it('in correlated subquery, allows access to fields of inner query without explicit table alias', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books { ID, (SELECT from bookshop.Books as Q { ID } where ID = Books.ID) as foo }`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(
        CQL`SELECT from bookshop.Books as Books { Books.ID, (SELECT from bookshop.Books as Q { Q.ID } where Q.ID = Books.ID) as foo }`,
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
          CQL`SELECT from bookshop.Books { ID, (SELECT from bookshop.Authors { ID } where name = title) as foo }`,
          model,
        ),
      ).to.throw(/"title" not found in the elements of "bookshop.Authors"/)
    })

    it('in nested correlated subqueries, allows access to fields of all outer queries', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books as B {
              (SELECT from bookshop.Authors as A {
                (SELECT from bookshop.Genres as G { ID } where descr = A.name and descr = B.title) as foo
              } where A.name = B.title) as foo
            }`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(
        CQL`SELECT from bookshop.Books as B {
              (SELECT from bookshop.Authors as A {
                (SELECT from bookshop.Genres as G { G.ID } where G.descr = A.name and G.descr = B.title) as foo
              } where A.name = B.title) as foo
            }`,
      )
    })

    it('in nested correlated subqueries, table alias may be shadowed', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books as B {
              (SELECT from bookshop.Authors as A {
                (SELECT from bookshop.Genres as B { ID } where A.name = B.descr) as foo
              } where A.name = B.title) as foo
            }`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(
        CQL`SELECT from bookshop.Books as B {
              (SELECT from bookshop.Authors as A {
                (SELECT from bookshop.Genres as B { B.ID } where A.name = B.descr) as foo
              } where A.name = B.title) as foo
            }`,
      )
    })
    it('in nested correlated subqueries, table alias may be shadowed', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books {
              (SELECT from bookshop.Authors {
                books.title
              } where name = Books.title) as foo
            }`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(
        CQL`SELECT from bookshop.Books as Books {
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
          CQL`SELECT from bookshop.Books as B {
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
              CQL`SELECT ID from bookshop.Books where ID = 5`,
            ],
          },
        ],
      }).columns('ID')

      const expected = SELECT.from('bookshop.Books as Books')
        .columns('Books.ID')
        .where([
          {
            list: [{ ref: ['Books', 'dedication_addressee_ID'] }],
          },
          'in',
          CQL`SELECT Books2.ID from bookshop.Books as Books2 where Books2.ID = 5`,
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
              CQL`SELECT Books.ID from bookshop.Books as Books where Books.ID = 5`,
            ],
          },
          'coAuthorUnmanaged',
        ],
      }).columns('ID')

      const list = [
        {
          list: [{ ref: ['Books', 'dedication_addressee_ID'] }],
        },
        'in',
        CQL`SELECT Books.ID from bookshop.Books as Books where Books.ID = 5`,
      ]

      const expected = SELECT.from('bookshop.Authors as coAuthorUnmanaged').columns('coAuthorUnmanaged.ID').where(`
          exists (
            SELECT 1 from bookshop.Books as Books where coAuthorUnmanaged.ID = Books.coAuthor_ID_unmanaged
          )
        `)

      expected.SELECT.where[1].SELECT.where.push('and', ...list)

      const res = cqn4sql(query, model)
      expect(res).to.deep.equal(expected)
    })

    it('handles value subquery in WHERE', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books { ID }
            WHERE (SELECT from bookshop.Books as qInWhere { ID }) = 5`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID }
            WHERE (SELECT from bookshop.Books as qInWhere { qInWhere.ID }) = 5`)
    })

    it('handles correlated value subquery in WHERE', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books { ID }
            WHERE (SELECT from bookshop.Books as qInWhere { ID } where ID = Books.ID) = 5`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID }
            WHERE (SELECT from bookshop.Books as qInWhere { qInWhere.ID } where qInWhere.ID = Books.ID) = 5`)
    })

    it('handles EXISTS subquery in WHERE', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Authors { ID } WHERE exists (
            SELECT 1 from bookshop.Books where ID = Authors.ID
            )`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep
        .equal(CQL`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE exists (
            SELECT 1 from bookshop.Books as Books where Books.ID = Authors.ID
          )`)
    })

    it('handles EXISTS subquery in WHERE, explicit table alias', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Authors as Books { ID } WHERE exists (
            SELECT 1 from bookshop.Books as Authors where ID > Books.ID
            )`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep
        .equal(CQL`SELECT from bookshop.Authors as Books { Books.ID } WHERE exists (
            SELECT 1 from bookshop.Books as Authors where Authors.ID > Books.ID
          )`)
    })

    it('handles the select list of an exists subquery like any other select list', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Authors { ID } WHERE exists (
            SELECT ID, stock, price from bookshop.Books where ID = Authors.ID
            )`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep
        .equal(CQL`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE exists (
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
