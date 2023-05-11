// cqn4sql must flatten and transform where exists shortcuts into subqueries
'use strict'
const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds/lib')
const { expect } = cds.test

describe('DELETE', () => {
  beforeAll(async () => {
    cds.model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })
  it('flatten structured access in where', () => {
    const { DELETE } = cds.ql
    let d = DELETE.from('bookshop.Books').where({ 'dedication.text': { '=': 'foo' } })
    const query = cqn4sql(d)
    const expected = JSON.parse(
      '{"DELETE":{"from":{"ref": ["bookshop.Books"], "as": "Books"},"where":[{"ref":["Books","dedication_text"]},"=",{"val":"foo"}]}}'
    )
    expect(query.DELETE).to.deep.equal(expected.DELETE)
  })

  it('DELETE with where exists expansion', () => {
    const { DELETE } = cds.ql
    let d = DELETE.from('bookshop.Books:author')
    const query = cqn4sql(d)
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
})
