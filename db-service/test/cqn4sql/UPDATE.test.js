// cqn4sql must flatten and transform where exists shortcuts into subqueries
'use strict'
const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds/lib')
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
    const query = cqn4sql(u)
    const expected = JSON.parse(
      '{"UPDATE":{"entity":{"ref":["bookshop.Books"], "as": "Books"},"where":[{"ref":["Books","dedication_text"]},"=",{"val":"foo"}]}}',
    )
    expect(query.UPDATE).to.deep.equal(expected.UPDATE)
  })

  it('UPDATE with data', () => {
    const { UPDATE } = cds.ql
    let u = UPDATE.entity('bookshop.Books').data({ ID: 5, name: 'test' })
    const query = cqn4sql(u, model)
    expect(query.__proto__.UPDATE.__proto__).to.haveOwnProperty('data')
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

  // we do not really understand a token stream such as a where clause,
  // hence we cannot easily rewrite a path expression into a `where exists` subquery
  // for the moment, we should issue a proper error instead of dumping.
  it('Update with join clause is rejected', () => {
    const { UPDATE } = cds.ql
    let u = UPDATE.entity('bookshop.Books').where(`author.name LIKE '%Bron%' or ( author.name LIKE '%King' and title = 'The Dark Tower') and stock >= 15`)
    expect( () => cqn4sql(u) ).to.throw('Path expressions for UPDATE statements are not supported. Use “where exists” with infix filters instead.')
  })

  // table alias in subquery should address Books instead of bookshop.Books
  it('UPDATE with where exists expansion', () => {
    const { UPDATE } = cds.ql
    let u = UPDATE.entity('bookshop.Books').where('exists author')
    const query = cqn4sql(u)
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
