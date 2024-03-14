'use strict'
const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds/lib')
const { expect } = cds.test

describe('Replace attribute search by search predicate', () => {
  let model
  beforeAll(async () => {
    model = cds.model = cds.compile.for.nodejs(await cds.load(`${__dirname}/../bookshop/db/schema`).then(cds.linked))
  })

  it('one string element with one search element', () => {
    // WithStructuredKey is the only entity with only one string element in the model ...
    let query = CQL`SELECT from bookshop.WithStructuredKey as wsk { second }`
    query.SELECT.search = [{ val: 'x' }]

    let res = cqn4sql(query, model)
    // single val is stored as val directly, not as expr with val
    const expected = CQL`SELECT from bookshop.WithStructuredKey as wsk {
      wsk.second
    } where search(wsk.second, 'x')`
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(expected)
  })

  it('one string element', () => {
    // WithStructuredKey is the only entity with only one string element in the model ...
    let query = CQL`SELECT from bookshop.WithStructuredKey as wsk { second }`
    query.SELECT.search = [{ val: 'x' }, 'or', { val: 'y' }]

    let res = cqn4sql(query, model)
    const expected = CQL`SELECT from bookshop.WithStructuredKey as wsk {
      wsk.second
    } where search(wsk.second, ('x' OR 'y'))`
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(expected)
  })

  it('multiple string elements', () => {
    let query = CQL`SELECT from bookshop.Genres { ID }`
    query.SELECT.search = [{ val: 'x' }, 'or', { val: 'y' }]

    let res = cqn4sql(query, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(CQL`SELECT from bookshop.Genres as Genres {
      Genres.ID
    } where search((Genres.name, Genres.descr, Genres.code), ('x' OR 'y'))`)
  })

  it('with existing WHERE clause', () => {
    let query = CQL`SELECT from bookshop.Genres { ID } where ID < 4 or ID > 5`
    query.SELECT.search = [{ val: 'x' }, 'or', { val: 'y' }]

    let res = cqn4sql(query, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(CQL`SELECT from bookshop.Genres as Genres {
      Genres.ID
    } where (Genres.ID < 4 or Genres.ID > 5)
        and search((Genres.name, Genres.descr, Genres.code), ('x' OR 'y'))`)
  })

  it('with filter on data source', () => {
    let query = CQL`SELECT from bookshop.Genres[ID < 4 or ID > 5] { ID }`
    query.SELECT.search = [{ val: 'x' }, 'or', { val: 'y' }]

    let res = cqn4sql(query, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(CQL`SELECT from bookshop.Genres as Genres {
      Genres.ID
    } where (Genres.ID < 4 or Genres.ID > 5)
        and search((Genres.name, Genres.descr, Genres.code), ('x' OR 'y'))`)
  })

  it('string fields inside struct', () => {
    let query = CQL`SELECT from bookshop.Person { ID }`
    query.SELECT.search = [{ val: 'x' }, 'or', { val: 'y' }]

    let res = cqn4sql(query, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(CQL`SELECT from bookshop.Person as Person {
      Person.ID
    } where search((Person.name, Person.placeOfBirth, Person.placeOfDeath, Person.address_street, Person.address_city), ('x' OR 'y'))`)
  })

  it('ignores virtual string elements', () => {
    let query = CQL`SELECT from bookshop.Foo { ID }`
    query.SELECT.search = [{ val: 'x' }, 'or', { val: 'y' }]

    let res = cqn4sql(query, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(CQL`SELECT from bookshop.Foo as Foo {
      Foo.ID
    }`)
  })
  it('Uses primary query source in case of joins', () => {
    let query = CQL`SELECT from bookshop.Books { ID, author.books.title as authorsBook }`
    query.SELECT.search = [{ val: 'x' }, 'or', { val: 'y' }]

    let res = cqn4sql(query, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(
      CQL`
      SELECT from bookshop.Books as Books
        left join bookshop.Authors as author on author.ID = Books.author_ID
        left join bookshop.Books as books2 on  books2.author_ID = author.ID
      {
        Books.ID,
        books2.title as authorsBook
      } where search((Books.createdBy, Books.modifiedBy, Books.anotherText, Books.title, Books.descr, Books.currency_code, Books.dedication_text, Books.dedication_sub_foo, Books.dedication_dedication), ('x' OR 'y')) `,
    )
  })
  it('Search columns if result is grouped', () => {
    // in this case, we actually search the "title" which comes from the join
    let query = CQL`SELECT from bookshop.Books { ID, author.books.title as authorsBook } group by title`
    query.SELECT.search = [{ val: 'x' }, 'or', { val: 'y' }]

    let res = cqn4sql(query, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(
      CQL`
      SELECT from bookshop.Books as Books
        left join bookshop.Authors as author on author.ID = Books.author_ID
        left join bookshop.Books as books2 on  books2.author_ID = author.ID
      {
        Books.ID,
        books2.title as authorsBook
      } where search(books2.title, ('x' OR 'y')) group by Books.title `,
    )
  })
  it('Search on navigation', () => {
    let query = CQL`SELECT from bookshop.Authors:books { ID }`
    query.SELECT.search = [{ val: 'x' }, 'or', { val: 'y' }]

    let res = cqn4sql(query, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(
      CQL`
      SELECT from bookshop.Books as books
      {
        books.ID,
      } where (
        exists(
          SELECT 1 from bookshop.Authors as Authors
          where Authors.ID = books.author_ID
        )
      ) and
      search((books.createdBy, books.modifiedBy, books.anotherText, books.title, books.descr, books.currency_code, books.dedication_text, books.dedication_sub_foo, books.dedication_dedication), ('x' OR 'y')) `,
    )
  })
  it('Search with aggregated column and groupby must be put into having', () => {
    // if we search on aggregated results, the search must be put into the having clause
    const { Books } = cds.entities
    let query = SELECT.from(Books)
      .columns({ args: [{ ref: ['title'] }], as: 'firstInAlphabet', func: 'MIN' })
      .groupBy('title')
      .search('Cat')

    expect(JSON.parse(JSON.stringify(cqn4sql(query, model)))).to.deep.equal(CQL`
      SELECT from bookshop.Books as Books {
        MIN(Books.title) as firstInAlphabet
      } group by Books.title having search(MIN(Books.title), 'Cat')`)
  })

  it('Ignore non string aggregates from being searched', () => {
    const query = CQL`
      SELECT from bookshop.Books {
        title,
        AVG(Books.stock) as searchRelevant,
      } group by title
      `

    query.SELECT.search = [{ val: 'x' }]

    expect(JSON.parse(JSON.stringify(cqn4sql(query, model)))).to.deep.equal(CQL`
      SELECT from bookshop.Books as Books {
        Books.title,
        AVG(Books.stock) as searchRelevant,
      } where search(Books.title, 'x') group by Books.title`)
  })
  it('aggregations which are not of type string are not searched', () => {
    const query = CQL`
      SELECT from bookshop.Books {
        ID,
        SUM(Books.stock) as notSearchRelevant,
      } group by title
      `

    query.SELECT.search = [{ val: 'x' }]

    expect(JSON.parse(JSON.stringify(cqn4sql(query, model)))).to.deep.equal(CQL`
      SELECT from bookshop.Books as Books {
        Books.ID,
        SUM(Books.stock) as notSearchRelevant,
      } group by Books.title`)
  })
  it('func is search relevant via cast', () => {
    // this aggregation is not relevant for search per default
    // but due to the cast to string, we search
    const query = CQL`
      SELECT from bookshop.Books {
        ID,
        substring(Books.stock) as searchRelevantViaCast: cds.String,
      } group by title
      `

    query.SELECT.search = [{ val: 'x' }]

    expect(JSON.parse(JSON.stringify(cqn4sql(query, model)))).to.deep.equal(CQL`
      SELECT from bookshop.Books as Books {
        Books.ID,
        substring(Books.stock) as searchRelevantViaCast: cds.String,
      } group by Books.title having search(substring(Books.stock), 'x')`)
  })
  it('xpr is search relevant via cast', () => {
    // this aggregation is not relevant for search per default
    // but due to the cast to string, we search
    const query = CQL`
      SELECT from bookshop.Books {
        ID,
        ('very' + 'useful' + 'string') as searchRelevantViaCast: cds.String,
        ('1' + '2' + '3') as notSearchRelevant: cds.Integer,
      } group by title
      `

    query.SELECT.search = [{ val: 'x' }]

    expect(JSON.parse(JSON.stringify(cqn4sql(query, model)))).to.deep.equal(CQL`
      SELECT from bookshop.Books as Books {
        Books.ID,
        ('very' + 'useful' + 'string') as searchRelevantViaCast: cds.String,
        ('1' + '2' + '3') as notSearchRelevant: cds.Integer,
      } group by Books.title having search(('very' + 'useful' + 'string'), 'x')`)
  })
})
