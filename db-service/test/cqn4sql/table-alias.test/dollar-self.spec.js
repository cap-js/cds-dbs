'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('table alias access - replace $self references', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql
    cqn4sql = q => orig(q, model)
  })

  it('escaped identifier does not hurt', () => {
    const transformed = cqn4sql(cds.ql`
    SELECT FROM bookshop.Books as ![FROM]
    {
      ![FROM].title as group,
    }
    where $self.group = 'foo'
    group by $self.group
    having $self.group = 'foo'
    order by $self.group
    `)
    const expected = cds.ql`
    SELECT from bookshop.Books as ![FROM]
    {
      ![FROM].title as group,
    }
    where ![FROM].title = 'foo'
    group by ![FROM].title
    having ![FROM].title = 'foo'
    order by ![FROM].title
    `
    expectCqn(transformed).to.equal(expected)
  })

  it('refer to other query element', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as Books {
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
  }`)
    const expected = cds.ql`SELECT from bookshop.Books as Books {
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
  }`
    expectCqn(transformed).to.equal(expected)
  })

  it('late replace join relevant paths', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Authors as Authors {
        Authors.name as author,
        $self.book as dollarSelfBook,
        books.title as book,
      } group by $self.book
     `)
    const expected = cds.ql`SELECT from bookshop.Authors as Authors left join bookshop.Books as books on books.author_ID = Authors.ID {
      Authors.name as author,
      books.title as dollarSelfBook,
      books.title as book
    } group by books.title
   `
    expectCqn(transformed).to.equal(expected)
  })

  it('in aggregation', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Authors as Authors {
        name as author,
        1+1 as xpr,
        years_between(dateOfBirth, dateOfDeath) as age
      }
      group by $self.author, $self.xpr
      order by $self.author, $self.xpr
     `)
    const expected = cds.ql`SELECT from bookshop.Authors as Authors {
      Authors.name as author,
      1+1 as xpr,
      years_between(Authors.dateOfBirth, Authors.dateOfDeath) as age
    }
    group by Authors.name, 1+1
    order by Authors.name, 1+1
   `
    expectCqn(transformed).to.equal(expected)
  })

  it('in having', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Authors {
        name as author,
        1+1 as xpr,
      }
      having $self.xpr = 2
     `)
    const expected = cds.ql`SELECT from bookshop.Authors as $A {
      $A.name as author,
      1+1 as xpr,
    }
    having (1+1) = 2
   `
    expectCqn(transformed).to.equal(expected)
  })

  it('in having with func', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books {
        author.name as author,
        count(*) as numberOfBooks,
      }
      group by author.name
      having $self.numberOfBooks > 1
     `)
    const expected = cds.ql`SELECT from bookshop.Books as $B
      left join bookshop.Authors as author on author.ID = $B.author_ID
     {
      author.name as author,
      count(*) as numberOfBooks,
    }
    group by author.name
    having count(*) > 1
   `
    expectCqn(transformed).to.equal(expected)
  })

  it('in where', () => {
    const transformed = cqn4sql(cds.ql`SELECT from bookshop.Authors {
        name as author,
        1+1 as xpr,
      }
      where 2 / $self.xpr = 1
     `)
    const expected = cds.ql`SELECT from bookshop.Authors as $A {
      $A.name as author,
      1+1 as xpr,
    }
    where 2 / (1+1) = 1
   `
    expectCqn(transformed).to.equal(expected)
  })

  it('refer to my own column in function expression', () => {
    const transformed = cqn4sql(cds.ql`
      SELECT from bookshop.Books as Books {
        cast('2007-07-07' as Date) as twoLeapYearsEarlier,
        cast('2013-07-06' as Date) as twoLeapYearsLater,
        months_between($self.twoLeapYearsEarlier, $self.twoLeapYearsLater)
      }`)
    const expected = cds.ql`
      SELECT from bookshop.Books as Books {
        cast('2007-07-07' as cds.Date) as twoLeapYearsEarlier,
        cast('2013-07-06' as cds.Date) as twoLeapYearsLater,
        months_between(cast('2007-07-07' as cds.Date), cast('2007-07-06' as cds.Date)) as months_between
      }`
    // cast expression inside argument is parsed without surrounding "xpr"
    // hence we need to adjust the expectation
    expected.SELECT.columns[2].args = [
      { xpr: expected.SELECT.columns[0].xpr },
      { xpr: expected.SELECT.columns[1].xpr },
    ]
    expectCqn(transformed).to.equal(expected)
  })

  it('refer to my own column in calc expression', () => {
    const transformed = cqn4sql(cds.ql`
      SELECT from bookshop.Books as Books {
        (cast('2007-07-07' as Date) + 1) as twoLeapYearsEarlier,
        (cast('2013-07-06' as Date) + 1) as twoLeapYearsLater,
        $self.twoLeapYearsEarlier +  months_between($self.twoLeapYearsEarlier + 15) as calc
      }`)
    const expected = cds.ql`
      SELECT from bookshop.Books as Books {
        (cast('2007-07-07' as cds.Date) + 1) as twoLeapYearsEarlier,
        (cast('2013-07-06' as cds.Date) + 1) as twoLeapYearsLater,
        (cast('2007-07-07' as cds.Date) + 1) + months_between((cast('2007-07-07' as cds.Date) + 1) + 15) as calc
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('$self in infix filter alongside path expression', () => {
    const transformed = cqn4sql(cds.ql`
      SELECT from bookshop.Books as Books {
        title,
        exists author.books[ author.name = title and title = $self.title ] as s
      }`)
    const expected = cds.ql`
      SELECT from bookshop.Books as Books {
        Books.title,
        exists (
          SELECT 1 from bookshop.Authors as $a where $a.ID = Books.author_ID and exists (
            SELECT 1 from bookshop.Books as $b
              inner join bookshop.Authors as author on author.ID = $b.author_ID
              where $b.author_ID = $a.ID and author.name = $b.title and $b.title = Books.title
          )
        ) as s
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('$self in nested exists infix filter', () => {
    const transformed = cqn4sql(cds.ql`
      SELECT from bookshop.Books as Books {
        title,
        exists author.books[ exists author.books[ title = $self.title ] ] as s
      }`)
    const expected = cds.ql`
      SELECT from bookshop.Books as Books {
        Books.title,
        exists (
          SELECT 1 from bookshop.Authors as $a where $a.ID = Books.author_ID and exists (
            SELECT 1 from bookshop.Books as $b where $b.author_ID = $a.ID and exists (
              SELECT 1 from bookshop.Authors as $a2 where $a2.ID = $b.author_ID and exists (
                SELECT 1 from bookshop.Books as $b2 where $b2.author_ID = $a2.ID and $b2.title = Books.title
              )
            )
          )
        ) as s
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('$self in deeply nested infix filter with multiple path expressions', () => {
    const transformed = cqn4sql(cds.ql`
      SELECT from bookshop.Books as Books {
        title,
        exists author.books[ author.name = title and exists author.books[ author.name = title and title = $self.title ] ] as s
      }`)
    const expected = cds.ql`
      SELECT from bookshop.Books as Books {
        Books.title,
        exists (
          SELECT 1 from bookshop.Authors as $a where $a.ID = Books.author_ID and exists (
            SELECT 1 from bookshop.Books as $b
              inner join bookshop.Authors as author on author.ID = $b.author_ID
              where $b.author_ID = $a.ID and author.name = $b.title and exists (
                SELECT 1 from bookshop.Authors as $a2 where $a2.ID = $b.author_ID and exists (
                  SELECT 1 from bookshop.Books as $b2
                    inner join bookshop.Authors as author2 on author2.ID = $b2.author_ID
                    where $b2.author_ID = $a2.ID and author2.name = $b2.title and $b2.title = Books.title
                )
              )
          )
        ) as s
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('$self in subquery refers to own projection, not outer query', () => {
    const transformed = cqn4sql(cds.ql`
      SELECT from bookshop.Authors as Authors {
        ID,
        1+1 as foo
      } where exists (
        SELECT from bookshop.Books { 2+2 as foo, $self.foo as bar }
        where author[$self.foo = 4].ID = 42
      )`)
    const expected = cds.ql`
      SELECT from bookshop.Authors as Authors {
        Authors.ID,
        1+1 as foo
      } where exists (
        SELECT from bookshop.Books as $B
          left outer join bookshop.Authors as author on author.ID = $B.author_ID and (2+2) = 4
        { 2+2 as foo, 2+2 as bar }
        where author.ID = 42
      )`
    expectCqn(transformed).to.equal(expected)
  })
})
