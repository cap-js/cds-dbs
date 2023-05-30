'use strict'
const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds/lib')
const { expect } = cds.test

describe('Replace attribute search by search predicate', () => {
  let model
  beforeAll(async () => {
    model = cds.model = cds.compile.for.nodejs(await cds.load(`${__dirname}/../bookshop/db/schema`).then(cds.linked))
  })

  it('Basic stream', () => {
    const q = STREAM.from('bookshop.Books')
    const q2 = STREAM.into('bookshop.Books')
    expect(() => cqn4sql(q, model)).to.not.throw()
    expect(() => cqn4sql(q2, model)).to.not.throw()
  })
  it('Transform from into where', () => {
    const q = STREAM.from('bookshop.Books:author')
    expect(cqn4sql(q, model)).to.deep.equal(
      STREAM.from('bookshop.Authors as author').where(`
            exists (
                SELECT 1 from bookshop.Books as Books where
                    Books.author_ID = author.ID
            )
        `),
    )
  })
  it('Paths get resolved', () => {
    const q = STREAM.from('bookshop.Books').where(`author.name = 'King'`)
    expect(cqn4sql(q, model)).to.deep.equal(
      STREAM.from(
        `
            bookshop.Books as Books left join bookshop.Authors as author
                on author.ID = Books.author_ID
        `,
      ).where(`author.name = 'King'`),
    )
  })
  it('Complex ref is resolved', () => {
    const q = STREAM.from(`bookshop.Authors[name = 'JK Rowling']:books[title = 'Harry Potter']`)
    const qInto = STREAM.into(`bookshop.Authors[name = 'JK Rowling']:books[title = 'Harry Potter']`)
    expect(cqn4sql(q, model)).to.deep.equal(
      STREAM.from('bookshop.Books as books').where(`
            exists (
                SELECT 1 from bookshop.Authors as Authors where Authors.ID = books.author_ID
                and Authors.name = 'JK Rowling'
            ) and books.title = 'Harry Potter'
        `),
    )
    expect(cqn4sql(qInto, model)).to.deep.equal(
      STREAM.into('bookshop.Books as books').where(`
        exists (
            SELECT 1 from bookshop.Authors as Authors where Authors.ID = books.author_ID
            and Authors.name = 'JK Rowling'
        ) and books.title = 'Harry Potter'
    `),
    )
  })
})
