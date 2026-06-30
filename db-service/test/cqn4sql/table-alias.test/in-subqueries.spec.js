'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn, expect } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('table alias access - in subqueries', () => {
  let model
  before(async () => {
    model = await loadModel()
    const orig = cqn4sql
    cqn4sql = (q, m) => orig(q, m ?? model)
  })

  it('respects aliases of outer queries and does not shadow them', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books {
        ID,
        (SELECT from bookshop.Books {
          author,
          (
            SELECT from bookshop.Books {
              author
          }) as bar
        }) as foo
      }`)
    const expected = cds.ql`
      SELECT from bookshop.Books as $B {
          $B.ID,
          (SELECT from bookshop.Books as $B2 { $B2.author_ID,
            (SELECT from bookshop.Books as $B3 { $B3.author_ID }) as bar
          }) as foo
        }`
    expectCqn(transformed).to.equal(expected)
  })

  it('respects aliases of outer queries and does not shadow them mix of regular subqueries and expands', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books {
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
      }`)
    const expected = cds.ql`
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
        }`
    expectCqn(transformed).to.equal(expected)
  })

  // explicit alias for FROM subquery is mandatory
  // could maybe be relaxed later
  it('applies the same alias handling in subqueries in FROM', () => {
    const transformed = cqn4sql(
      cds.ql`SELECT from (SELECT from bookshop.Books { ID, stock }) as Books { ID, Books.stock }`,
    )
    const expected = cds.ql`SELECT from (SELECT from bookshop.Books as $B { $B.ID, $B.stock }) as Books { Books.ID, Books.stock }`
    expectCqn(transformed).to.equal(expected)
  })

  it('explicit alias for FROM subquery', () => {
    const transformed = cqn4sql(cds.ql`SELECT from (
      SELECT from bookshop.Books as Books {
        ID, Books.stock, Books.dedication
      }) as B { ID, B.stock, B.dedication }`)
    const expected = cds.ql`SELECT from (
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
        }`
    expectCqn(transformed).to.equal(expected)
  })

  it('wildcard expansion of subquery in from ignores assocs', () => {
    const transformed = cqn4sql(cds.ql`SELECT from ( SELECT from bookshop.Orders as Orders) as O`)
    const expected = cds.ql`SELECT from (
      SELECT from bookshop.Orders as Orders {
        Orders.ID,
      }
    ) as O {
      O.ID,
    }`
    expectCqn(transformed).to.equal(expected)
  })

  it('prepends unique alias for function args or expressions on top of anonymous subquery', () => {
    const transformed = cqn4sql(cds.ql`SELECT from ( SELECT from bookshop.Orders as Orders ) {
      sum(ID) as foo,
      ID + 42 as anotherFoo
    }`)
    const expected = cds.ql`SELECT from (
      SELECT from bookshop.Orders as Orders {
        Orders.ID
      }
    ) as __select__ {
      sum(__select__.ID) as foo,
      __select__.ID + 42 as anotherFoo
    }`
    expectCqn(transformed).to.equal(expected)
  })

  it('wildcard expansion for subquery in FROM', () => {
    // REVISIT: order not stable, move "ID" to top of columns in subquery in from
    const transformed = cqn4sql(cds.ql`SELECT from (
      SELECT from bookshop.Books as Books {
        sum(stock) as totalStock,
        ID,
        Books.stock,
        Books.dedication,
        Books.author
      }
     ) as B`)
    const expected = cds.ql`SELECT from (
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
    }`
    expectCqn(transformed).to.equal(expected)
  })

  it('nested subqueries propagate FK columns through wildcard expansion', () => {
    const transformed = cqn4sql(cds.ql`SELECT from (
      SELECT from (
        SELECT from bookshop.Books as Books { Books.author }
      ) as mid
    ) as outer`)
    const expected = cds.ql`SELECT from (
      SELECT from (
        SELECT from bookshop.Books as Books {
          Books.author_ID
        }
      ) as mid {
        mid.author_ID
      }
    ) as outer {
      outer.author_ID
    }`
    expectCqn(transformed).to.equal(expected)
  })

  it('cannot access table name of FROM subquery in outer query', () => {
    expect(() =>
      cqn4sql(cds.ql`SELECT from (SELECT from bookshop.Books as Books { ID, Books.stock }) as B { ID, Books.stock }`),
    ).to.throw(/"Books" not found in the elements of "B"/)
  })

  it('expose column of inner query in outer query', () => {
    const transformed = cqn4sql(
      cds.ql`SELECT from (SELECT from bookshop.Books as Books { ID, Books.stock as Books }) as B { ID, B.Books }`,
    )
    const expected = cds.ql`SELECT from (SELECT from bookshop.Books as Books { Books.ID, Books.stock as Books }) as B { B.ID, B.Books }`
    expectCqn(transformed).to.equal(expected)
  })

  it('preserves explicit table alias in FROM subquery', () => {
    const transformed = cqn4sql(
      cds.ql`SELECT from (SELECT from bookshop.Books as inner { ID, inner.stock }) as Books { ID, Books.stock }`,
    )
    const expected = cds.ql`SELECT from (SELECT from bookshop.Books as inner { inner.ID, inner.stock }) as Books { Books.ID, Books.stock }`
    expectCqn(transformed).to.equal(expected)
  })

  it('applies the same alias handling in value subqueries', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books { ID, (SELECT from bookshop.Books { ID }) as foo }`)
    const expected = cds.ql`SELECT from bookshop.Books as $B {
          $B.ID,
          (SELECT from bookshop.Books as $B2 { $B2.ID } ) as foo
        }`
    expectCqn(transformed).to.equal(expected)
  })

  it('supports correlated value subquery in select list', () => {
    const transformed = cqn4sql(
      cds.ql`SELECT from bookshop.Books as Books { ID, (SELECT from bookshop.Books as Q { ID } where Q.ID = Books.ID) as foo }`,
    )
    const expected = cds.ql`SELECT from bookshop.Books as Books { Books.ID, (SELECT from bookshop.Books as Q { Q.ID } where Q.ID = Books.ID) as foo }`
    expectCqn(transformed).to.equal(expected)
  })

  it('supports correlated value subquery in select list, explicit table alias for outer query', () => {
    const transformed = cqn4sql(
      cds.ql`SELECT from bookshop.Books as O { ID, (SELECT from bookshop.Books as Q { ID } where Q.ID = O.ID) as foo }`,
    )
    const expected = cds.ql`SELECT from bookshop.Books as O { O.ID, (SELECT from bookshop.Books as Q { Q.ID } where Q.ID = O.ID) as foo }`
    expectCqn(transformed).to.equal(expected)
  })

  it('in correlated subquery, allows access to fields of inner query without explicit table alias', () => {
    const transformed = cqn4sql(
      cds.ql`SELECT from bookshop.Books as Books { ID, (SELECT from bookshop.Books as Q { ID } where ID = Books.ID) as foo }`,
    )
    const expected = cds.ql`SELECT from bookshop.Books as Books { Books.ID, (SELECT from bookshop.Books as Q { Q.ID } where Q.ID = Books.ID) as foo }`
    expectCqn(transformed).to.equal(expected)
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
      ),
    ).to.throw(/"title" not found in the elements of "bookshop.Authors"/)
  })

  it('in nested correlated subqueries, allows access to fields of all outer queries', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as B {
          (SELECT from bookshop.Authors as A {
            (SELECT from bookshop.Genres as G { ID } where descr = A.name and descr = B.title) as foo
          } where A.name = B.title) as foo
        }`)
    const expected = cds.ql`SELECT from bookshop.Books as B {
          (SELECT from bookshop.Authors as A {
            (SELECT from bookshop.Genres as G { G.ID } where G.descr = A.name and G.descr = B.title) as foo
          } where A.name = B.title) as foo
        }`
    expectCqn(transformed).to.equal(expected)
  })

  it('in nested correlated subqueries, table alias may be shadowed', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as B {
          (SELECT from bookshop.Authors as A {
            (SELECT from bookshop.Genres as B { ID } where A.name = B.descr) as foo
          } where A.name = B.title) as foo
        }`)
    const expected = cds.ql`SELECT from bookshop.Books as B {
          (SELECT from bookshop.Authors as A {
            (SELECT from bookshop.Genres as B { B.ID } where A.name = B.descr) as foo
          } where A.name = B.title) as foo
        }`
    expectCqn(transformed).to.equal(expected)
  })

  it('in nested correlated subqueries, table alias may be shadowed', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as Books {
          (SELECT from bookshop.Authors as Authors {
            books.title
          } where name = Books.title) as foo
        }`)
    const expected = cds.ql`SELECT from bookshop.Books as Books {
          (SELECT from bookshop.Authors as Authors
              left join bookshop.Books as books2  on books2.author_ID = Authors.ID {
            books2.title as books_title
          } where Authors.name = Books.title) as foo
        }`
    expectCqn(transformed).to.equal(expected)
  })

  it('in nested correlated subqueries, table alias may be shadowed (2)', () => {
    expect(() =>
      cqn4sql(cds.ql`SELECT from bookshop.Books as B {
        (SELECT from bookshop.Authors as A {
          (SELECT from bookshop.Genres as B { ID } where A.name = B.title) as foo
        } where A.name = B.title) as foo
      }`),
    ).to.throw(/"title" not found in "bookshop.Genres"/)
  })

  it('handles ref in list', () => {
    const transformed = cqn4sql(SELECT.from({
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
    }).columns('ID'))
    const expected = SELECT.from('bookshop.Books as $B')
      .columns('$B.ID')
      .where([
        {
          list: [{ ref: ['$B', 'dedication_addressee_ID'] }],
        },
        'in',
        cds.ql`SELECT $B2.ID from bookshop.Books as $B2 where $B2.ID = 5`,
      ])
    expectCqn(transformed).to.equal(expected)
  })

  it('handles ref in list of from with scoped query', () => {
    const transformed = cqn4sql(SELECT.from({
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
    }).columns('ID'))

    const expected = SELECT.from('bookshop.Authors as coAuthorUnmanaged').columns('coAuthorUnmanaged.ID').where(`
        exists (
          SELECT 1 from bookshop.Books as $B where coAuthorUnmanaged.ID = $B.coAuthor_ID_unmanaged
        )
      `)
    expected.SELECT.where[1].SELECT.where.push('and', ...[
      { list: [{ ref: ['$B', 'dedication_addressee_ID'] }] },
      'in',
      cds.ql`SELECT Books.ID from bookshop.Books as Books where Books.ID = 5`,
    ])
    expectCqn(transformed).to.equal(expected)
  })

  it('handles value subquery in WHERE', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID }
        WHERE (SELECT from bookshop.Books as qInWhere { ID }) = 5`)
    const expected = cds.ql`SELECT from bookshop.Books as Books { Books.ID }
        WHERE (SELECT from bookshop.Books as qInWhere { qInWhere.ID }) = 5`
    expectCqn(transformed).to.equal(expected)
  })

  it('handles correlated value subquery in WHERE', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID }
        WHERE (SELECT from bookshop.Books as qInWhere { ID } where ID = Books.ID) = 5`)
    const expected = cds.ql`SELECT from bookshop.Books as Books { Books.ID }
        WHERE (SELECT from bookshop.Books as qInWhere { qInWhere.ID } where qInWhere.ID = Books.ID) = 5`
    expectCqn(transformed).to.equal(expected)
  })

  it('handles EXISTS subquery in WHERE', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Authors as Authors { ID } WHERE exists (
        SELECT 1 from bookshop.Books as Books where ID = Authors.ID
        )`)
    const expected = cds.ql`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE exists (
        SELECT 1 from bookshop.Books as Books where Books.ID = Authors.ID
      )`
    expectCqn(transformed).to.equal(expected)
  })

  it('handles EXISTS subquery in WHERE, explicit table alias', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Authors as Books { ID } WHERE exists (
        SELECT 1 from bookshop.Books as Authors where ID > Books.ID
        )`)
    const expected = cds.ql`SELECT from bookshop.Authors as Books { Books.ID } WHERE exists (
        SELECT 1 from bookshop.Books as Authors where Authors.ID > Books.ID
      )`
    expectCqn(transformed).to.equal(expected)
  })

  it('handles the select list of an exists subquery like any other select list', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Authors as Authors { ID } WHERE exists (
        SELECT ID, stock, price from bookshop.Books as Books where ID = Authors.ID
        )`)
    const expected = cds.ql`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE exists (
        SELECT Books.ID, Books.stock, Books.price from bookshop.Books as Books where Books.ID = Authors.ID
      )`
    expectCqn(transformed).to.equal(expected)
  })

  it('handles WHERE inside the sub query with a priority of the external query over the association inside the entity', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Authors as author { ID, (SELECT from bookshop.Books as books { ID } WHERE books.author.ID = author.ID) as books}`)

    // REVISIT: calling cqn4sql with the results throws
    // "Cannot redefine property: element"
    const resultCopy = JSON.parse(JSON.stringify(transformed))
    expectCqn(resultCopy).to.equal(cds.ql`SELECT from bookshop.Authors as author { author.ID, (SELECT from bookshop.Books as books { books.ID } WHERE books.author_ID = author.ID) as books}`)

    // Ensure that it throws when not using the nodejs model
    expect(() => cqn4sql(JSON.parse(JSON.stringify(transformed)))).to.throw(/author_ID/)

    const nodeModel = cds.compile.for.nodejs(JSON.parse(JSON.stringify(model)))
    const repeat = cqn4sql(resultCopy, nodeModel)

    // Ensure sure that the where clause does not change
    expect(resultCopy).to.deep.equal(repeat)
  })
})
