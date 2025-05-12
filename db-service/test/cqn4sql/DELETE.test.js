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
    let d = DELETE.from('bookshop.Books as Books').where({ 'dedication.text': { '=': 'foo' } })
    const query = cqn4sql(d, model)
    const expected = JSON.parse(
      '{"DELETE":{"from":{"ref": ["bookshop.Books"], "as": "Books"},"where":[{"ref":["Books","dedication_text"]},"=",{"val":"foo"}]}}',
    )
    expect(query.DELETE).to.deep.equal(expected.DELETE)
  })

  it('DELETE with where exists expansion', () => {
    const { DELETE } = cds.ql
    let d = DELETE.from('bookshop.Books:author as author')
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
                  "as": "$B"
                },
                "columns": [
                  {
                    "val": 1
                  }
                ],
                "where": [
                  {
                    "ref": [
                      "$B",
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
    let d = DELETE.from('bookshop.Books:author as author').where(`books.title = 'Harry Potter'`)
    const query = cqn4sql(d, forNodeModel)

    // this is the final exists subquery
    const subquery = cds.ql`
     SELECT author.ID from bookshop.Authors as author
      left join bookshop.Books as books on books.author_ID = author.ID
     where exists (
      SELECT 1 from bookshop.Books as $B where $B.author_ID = author.ID
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
          as: 'author'
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
                as: '$B',
              },
              columns: [
                {
                  val: 1,
                },
              ],
              where: [
                {
                  ref: ['$B', 'author_ID'],
                },
                '=',
                {
                  ref: ['author', 'ID'],
                },
                'and',
                {
                  ref: ['$B', 'ID'],
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
    let d = DELETE.from('bookshop.Reproduce[author = null and ID = 99]:accessGroup as accessGroup')
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
                as: '$R',
              },
              columns: [
                {
                  val: 1,
                },
              ],
              where: [
                {
                  ref: ['$R', 'accessGroup_ID'],
                },
                '=',
                {
                  ref: ['accessGroup', 'ID'],
                },
                'and',
                {
                  xpr: [
                    {
                      ref: ['$R', 'author_ID'],
                    },
                    '=',
                    {
                      val: null,
                    },
                  ],
                },
                'and',
                {
                  ref: ['$R', 'ID'],
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
})
