// cqn4sql must flatten and transform where exists shortcuts into subqueries
'use strict'
const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds')
const { expect } = cds.test

describe('UPDATE', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  // PB: entity is always parsed as simple string
  //     cqn4sql normalizes it to `entity: {"ref": […], "as": "…"}`
  it('normalize update target format', () => {
    const { UPDATE } = cds.ql
    let u = UPDATE.entity('bookshop.Books').where({ 'dedication.text': { '=': 'foo' } })
    const query = cqn4sql(u, model)
    const expected = JSON.parse(
      '{"UPDATE":{"entity":{"ref":["bookshop.Books"], "as": "Books"},"where":[{"ref":["Books","dedication_text"]},"=",{"val":"foo"}]}}',
    )
    expect(query.UPDATE).to.deep.equal(expected.UPDATE)
  })

  it('UPDATE with data', () => {
    const { UPDATE } = cds.ql
    let u = UPDATE.entity('bookshop.Books').data({ ID: 5, name: 'test' })
    const query = cqn4sql(u, model)
    expect(query.UPDATE).to.have.property('data')
  })
  it('xpr in UPDATE with "with" are be considered', () => {
    const { UPDATE } = cds.ql
    let u = UPDATE.entity('bookshop.Books').with({
      applyDiscount: {
        func: 'discount',
        args: [{ ref: ['price'] }, { ref: ['dedication', 'sub', 'foo'] }],
      },
      getAuthors: {
        SELECT: {
          from: { ref: ['bookshop.Authors'] },
          columns: [
            { ref: ['name'] },
            {
              func: 'dummy',
              args: [{ ref: ['Authors', 'address', 'street'] }],
            },
          ],
        },
      },
    })
    const query = cqn4sql(u, model)
    expect(query.UPDATE.with).deep.equal({
      applyDiscount: {
        func: 'discount',
        args: [{ ref: ['Books', 'price'] }, { ref: ['Books', 'dedication_sub_foo'] }],
      },
      getAuthors: {
        SELECT: {
          from: { ref: ['bookshop.Authors'], as: 'Authors' },
          columns: [
            { ref: ['Authors', 'name'] },
            {
              func: 'dummy',
              args: [{ ref: ['Authors', 'address_street'] }],
              as: 'dummy',
            },
          ],
        },
      },
    })
  })

  it('Update with path expressions in where is handled', () => {
    const { UPDATE } = cds.ql
    let u = UPDATE.entity({ ref: ['bookshop.Books'] }).where(
      `author.name LIKE '%Bron%' or ( author.name LIKE '%King' and title = 'The Dark Tower') and stock >= 15`,
    )

    let expected = UPDATE.entity({ ref: ['bookshop.Books'] })

    expected.UPDATE.where = [
      { list: [{ ref: ['Books2', 'ID'] }] },
      'in',
      CQL`
            (SELECT Books.ID from bookshop.Books as Books
              left join bookshop.Authors as author on author.ID = Books.author_ID
              where author.name LIKE '%Bron%' or ( author.name LIKE '%King' and Books.title = 'The Dark Tower') and Books.stock >= 15
            )
      `,
    ]
    expected.UPDATE.entity = {
      as: 'Books2',
      ref: ['bookshop.Books'],
    }
    let res = cqn4sql(u, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(JSON.parse(JSON.stringify(expected)))
  })

  it('Update with path expressions to many', () => {
    const { UPDATE } = cds.ql
    let u = UPDATE.entity({ ref: ['bookshop.Authors'] }).where(`books.title LIKE '%Heights%'`)

    let expected = UPDATE.entity({ ref: ['bookshop.Authors'] })

    expected.UPDATE.where = [
      { list: [{ ref: ['Authors2', 'ID'] }] },
      'in',
      CQL`
      (SELECT Authors.ID from bookshop.Authors as Authors
                left join bookshop.Books as books on books.author_ID = Authors.ID
                where books.title LIKE '%Heights%'
              )
    `,
    ]
    expected.UPDATE.entity = {
      as: 'Authors2',
      ref: ['bookshop.Authors'],
    }
    let res = cqn4sql(u, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(JSON.parse(JSON.stringify(expected)))
  })

  // table alias in subquery should address Books instead of bookshop.Books
  it('UPDATE with where exists expansion', () => {
    const { UPDATE } = cds.ql
    let u = UPDATE.entity('bookshop.Books').where('exists author')
    const query = cqn4sql(u, model)
    // console.log(JSON.stringify(query))
    // how to express this in CQN?
    // DELETE.from({ref: ['bookshop.Authors'], as: 'author'}).where('exists ( SELECT 1 from bookshop.Books as Books where author_ID = author.ID)')
    const expected = JSON.parse(`{
        "UPDATE": {
          "where": [
            "exists",
            {
              "SELECT": {
                "from": {
                  "ref": [
                    "bookshop.Authors"
                  ],
                  "as": "author"
                },
                "columns": [
                  {
                    "val": 1
                  }
                ],
                "where": [
                  {
                    "ref": [
                      "author",
                      "ID"
                    ]
                  },
                  "=",
                  {
                    "ref": [
                      "Books",
                      "author_ID"
                    ]
                  }
                ]
              }
            }
          ],
          "entity": {"ref": ["bookshop.Books"], "as": "Books"}
        }
      }`)
    expect(query.UPDATE).to.deep.equal(expected.UPDATE)
  })
})
describe('UPDATE with path expression', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/model/update').then(cds.linked)
    model = cds.compile.for.nodejs(model)
  })

  it('with path expressions with draft enabled entity', async () => {
    const { UPDATE } = cds.ql
    let u = UPDATE.entity({ ref: ['bookshop.CatalogService.Books'] }).where(`author.name LIKE '%Bron%'`)

    let expected = UPDATE.entity({ ref: ['bookshop.CatalogService.Books'] })

    // dont use virtual key `isActiveEntity` in `UPDATE … where (<key>) in <subquery>`
    expected.UPDATE.where = [
      { list: [{ ref: ['Books2', 'ID'] }] },
      'in',
      CQL`
            (SELECT Books.ID from bookshop.CatalogService.Books as Books
              left join bookshop.CatalogService.Authors as author on author.ID = Books.author_ID
              where author.name LIKE '%Bron%'
            )
      `,
    ]
    expected.UPDATE.entity = {
      as: 'Books2',
      ref: ['bookshop.CatalogService.Books'],
    }
    let res = cqn4sql(u, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(JSON.parse(JSON.stringify(expected)))
  })

  it('path expression via calculated element leads to subquery if used in where', () => {
    const q = UPDATE('bookshop.Orders.Items').set({ price: 5 }).where('price = 4.99')

    const res = cqn4sql(q, model)

    const expected = UPDATE.entity({ ref: ['bookshop.Orders.Items'] }).alias('Items2')
    expected.UPDATE.where = [
      {
        list: [{ ref: ['Items2', 'up__ID'] }, { ref: ['Items2', 'book_ID'] }],
      },
      'in',
      cds.ql`
        (SELECT
          Items.up__ID,
          Items.book_ID
        FROM bookshop.Orders.Items AS Items
        LEFT JOIN bookshop.Books AS book ON book.ID = Items.book_ID
        WHERE (book.stock * 2) = 4.99
        )
      `,
    ]

    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(JSON.parse(JSON.stringify(expected)))
  })

  it('if there is no path expression in the where, we dont need subselect magic', () => {
    const q = UPDATE('bookshop.Orders.Items').set({ quantity: 3 }).where('1 = 1')
    const res = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(res))).to.eql({
      UPDATE: {
        entity: { ref: ['bookshop.Orders.Items'], as: 'Items' },
        where: [{ val: 1 }, '=', { val: 1 }],
      },
    })
    expect(res.UPDATE).to.have.property('data')
  })
})

describe('UPDATE with path expression more complex', () => {
  let forNodeModel
  beforeAll(async () => {
    cds.model = await cds.load(__dirname + '/../bookshop/srv/cat-service').then(cds.linked)
    forNodeModel = cds.compile.for.nodejs(JSON.parse(JSON.stringify(cds.model)))
  })

  it('inner joins for the path expression at the leaf of scoped queries', () => {
    let query = UPDATE.entity('bookshop.Authors:books[genre.name = null]')

    const transformed = cqn4sql(query, forNodeModel)
    const subquery = cds.ql`
      SELECT books.ID from bookshop.Books as books
        inner join bookshop.Genres as genre on genre.ID = books.genre_ID
      WHERE EXISTS (
        SELECT 1 from bookshop.Authors as Authors where Authors.ID = books.author_ID
      ) and genre.name = null`
    const expected = UPDATE.entity('bookshop.Books').alias('books2')
    expected.UPDATE.where = [{ list: [{ ref: ['books2', 'ID'] }] }, 'in', subquery]

    expect(transformed).to.deep.equal(expected)
  })
  it('inner joins for the path expression at the leaf of scoped queries, two assocs (UPDATE)', () => {
    let query = UPDATE.entity('bookshop.Authors:books[genre.parent.name = null]')

    const transformed = cqn4sql(query, forNodeModel)
    const subquery = cds.ql`
      SELECT books.ID from bookshop.Books as books
        inner join bookshop.Genres as genre on genre.ID = books.genre_ID
        inner join bookshop.Genres as parent on parent.ID = genre.parent_ID
      WHERE EXISTS (
        SELECT 1 from bookshop.Authors as Authors where Authors.ID = books.author_ID
      ) and parent.name = null`
    const expected = UPDATE.entity('bookshop.Books').alias('books2')
    expected.UPDATE.where = [{ list: [{ ref: ['books2', 'ID'] }] }, 'in', subquery]

    expect(transformed).to.deep.equal(expected)
  })
  it('inner joins for the path expression NOT at the leaf of scoped queries, two assocs (UPDATE)', () => {
    let query = UPDATE.entity(`bookshop.Authors[books.title = 'bar']:books[genre.parent.name = null]`).alias('MyBook')

    const transformed = cqn4sql(query, forNodeModel)
    const subquery = cds.ql`
      SELECT MyBook.ID from bookshop.Books as MyBook
        inner join bookshop.Genres as genre on genre.ID = MyBook.genre_ID
        inner join bookshop.Genres as parent on parent.ID = genre.parent_ID
      WHERE EXISTS (
        SELECT 1 from bookshop.Authors as Authors
          inner join bookshop.Books as books on books.author_ID = Authors.ID
        where Authors.ID = MyBook.author_ID and books.title = 'bar'
      ) and parent.name = null`
    const expected = UPDATE.entity('bookshop.Books').alias('MyBook2')
    expected.UPDATE.where = [{ list: [{ ref: ['MyBook2', 'ID'] }] }, 'in', subquery]

    expect(transformed).to.deep.equal(expected)
  })
})
