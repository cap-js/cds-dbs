// cqn4sql must flatten and transform where exists shortcuts into subqueries
'use strict'
const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds')
const { expect } = cds.test

describe('DELETE', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })
  it('flatten structured access in where', () => {
    const { DELETE } = cds.ql
    let d = DELETE.from('bookshop.Books').where({ 'dedication.text': { '=': 'foo' } })
    const query = cqn4sql(d, model)
    const expected = JSON.parse(
      '{"DELETE":{"from":{"ref": ["bookshop.Books"], "as": "Books"},"where":[{"ref":["Books","dedication_text"]},"=",{"val":"foo"}]}}',
    )
    expect(query.DELETE).to.deep.equal(expected.DELETE)
  })

  it('DELETE with where exists expansion', () => {
    const { DELETE } = cds.ql
    let d = DELETE.from('bookshop.Books:author')
    const query = cqn4sql(d, model)
    // how to express this in CQN?
    // DELETE.from({ref: ['bookshop.Authors'], as: 'author'}).where('exists ( SELECT 1 from bookshop.Books as Books where author_ID = author.ID)')
    const expected = JSON.parse(`{
        "DELETE": {
          "from": {
            "ref": [
              "bookshop.Authors"
            ],
            "as": "author"
          },
          "where": [
            "exists",
            {
              "SELECT": {
                "from": {
                  "ref": [
                    "bookshop.Books"
                  ],
                  "as": "Books"
                },
                "columns": [
                  {
                    "val": 1
                  }
                ],
                "where": [
                  {
                    "ref": [
                      "Books",
                      "author_ID"
                    ]
                  },
                  "=",
                  {
                    "ref": [
                      "author",
                      "ID"
                    ]
                  }
                ]
              }
            }
          ]
        }
      }`)
    expect(query.DELETE).to.deep.equal(expected.DELETE)
  })
  it('DELETE with where exists expansion and path expression', () => {
    const forNodeModel = cds.compile.for.nodejs(JSON.parse(JSON.stringify(cds.model)))
    const { DELETE } = cds.ql
    let d = DELETE.from('bookshop.Books:author').where(`books.title = 'Harry Potter'`)
    const query = cqn4sql(d, forNodeModel)

    // this is the final exists subquery
    const subquery = CQL`
     SELECT author.ID from bookshop.Authors as author
      left join bookshop.Books as books on books.author_ID = author.ID
     where exists (
      SELECT 1 from bookshop.Books as Books2 where Books2.author_ID = author.ID
     ) and books.title = 'Harry Potter'
    `
    const expected = JSON.parse(`{
      "DELETE": {
          "from": {
            "ref": [
              "bookshop.Authors"
            ],
            "as": "author2"
          }
        }
      }`)
    expected.DELETE.where = [
      {
        list: [
          {
            ref: ['author2', 'ID'],
          },
        ],
      },
      'in',
      subquery,
    ]
    expect(query.DELETE).to.deep.equal(expected.DELETE)
  })

  it('in a list with exactly one val, dont transform to key comparison', () => {
    const query = {
      DELETE: {
        from: {
          ref: [
            {
              id: 'bookshop.Books',
              where: [
                {
                  ref: ['ID'],
                },
                'in',
                {
                  list: [
                    {
                      val: 'b6248f67-6f8b-4816-a096-0b65c2349143',
                    },
                  ],
                },
              ],
            },
            'author',
          ],
        },
      },
    }

    const expected = {
      DELETE: {
        from: {
          ref: ['bookshop.Authors'],
          as: 'author',
        },
        where: [
          'exists',
          {
            SELECT: {
              from: {
                ref: ['bookshop.Books'],
                as: 'Books',
              },
              columns: [
                {
                  val: 1,
                },
              ],
              where: [
                {
                  ref: ['Books', 'author_ID'],
                },
                '=',
                {
                  ref: ['author', 'ID'],
                },
                'and',
                {
                  ref: ['Books', 'ID'],
                },
                'in',
                {
                  list: [
                    {
                      val: 'b6248f67-6f8b-4816-a096-0b65c2349143',
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    }
    const res = cqn4sql(query, model)
    expect(res).to.deep.equal(expected)
  })

  it('DELETE with assoc filter and where exists expansion', () => {
    const { DELETE } = cds.ql
    let d = DELETE.from('bookshop.Reproduce[author = null and ID = 99]:accessGroup')
    const query = cqn4sql(d, model)

    const expected = {
      DELETE: {
        from: {
          ref: ['bookshop.AccessGroups'],
          as: 'accessGroup',
        },
        where: [
          'exists',
          {
            SELECT: {
              from: {
                ref: ['bookshop.Reproduce'],
                as: 'Reproduce',
              },
              columns: [
                {
                  val: 1,
                },
              ],
              where: [
                {
                  ref: ['Reproduce', 'accessGroup_ID'],
                },
                '=',
                {
                  ref: ['accessGroup', 'ID'],
                },
                'and',
                {
                  xpr: [
                    {
                      ref: ['Reproduce', 'author_ID'],
                    },
                    '=',
                    {
                      val: null,
                    },
                  ],
                },
                'and',
                {
                  ref: ['Reproduce', 'ID'],
                },
                '=',
                {
                  val: 99,
                },
              ],
            },
          },
        ],
      },
    }
    expect(query.DELETE).to.deep.equal(expected.DELETE)
  })

  describe('with path expressions', () => {
    let forNodeModel
    beforeAll(() => {
      // subqueries reference flat author_ID, which is not part of client csn
      forNodeModel = cds.compile.for.nodejs(JSON.parse(JSON.stringify(cds.model)))
    })

    it('inner joins for the path expression at the leaf of scoped queries', () => {
      let query = DELETE.from('bookshop.Authors:books[genre.name = null]')
      const transformed = cqn4sql(query, forNodeModel)

      const subquery = cds.ql`
        SELECT books.ID from bookshop.Books as books
          inner join bookshop.Genres as genre on genre.ID = books.genre_ID
        WHERE EXISTS (
          SELECT 1 from bookshop.Authors as Authors where Authors.ID = books.author_ID
        ) and genre.name = null`
      const expected = DELETE.from('bookshop.Books').alias('books2')
      expected.DELETE.where = [{ list: [{ ref: ['books2', 'ID'] }] }, 'in', subquery]

      expect(transformed).to.deep.equal(expected)
    })

    it('inner joins for the path expression at the leaf of scoped queries, two assocs', () => {
      let query = DELETE.from('bookshop.Authors:books[genre.parent.name = null]')
      const transformed = cqn4sql(query, forNodeModel)

      const subquery = cds.ql`
        SELECT books.ID from bookshop.Books as books
          inner join bookshop.Genres as genre on genre.ID = books.genre_ID
          inner join bookshop.Genres as parent on parent.ID = genre.parent_ID
        WHERE EXISTS (
          SELECT 1 from bookshop.Authors as Authors where Authors.ID = books.author_ID
        ) and parent.name = null`
      const expected = DELETE.from('bookshop.Books').alias('books2')
      expected.DELETE.where = [{ list: [{ ref: ['books2', 'ID'] }] }, 'in', subquery]

      expect(transformed).to.deep.equal(expected)
    })
    it('inner joins for the path expression NOT at the leaf of scoped queries, two assocs', () => {
      let query = DELETE.from(`bookshop.Authors[books.title = 'bar']:books[genre.parent.name = null]`).alias('MyBook')

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
      const expected = DELETE.from('bookshop.Books').alias('MyBook2')
      expected.DELETE.where = [{ list: [{ ref: ['MyBook2', 'ID'] }] }, 'in', subquery]

      expect(transformed).to.deep.equal(expected)
    })
  })
})
