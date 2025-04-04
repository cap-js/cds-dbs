/**
 * Test replacements which cqn4sql performs.
 */
'use strict'

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds')
const { expect } = cds.test
describe('in where', () => {
  let model
  beforeAll(async () => {
    model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  it('replace ` in <empty array>` in where', () => {
    const original = SELECT.from('bookshop.Books')
      .alias('Books')
      .columns(['ID'])
      .where({ ID: { in: [] } })

    expect(cqn4sql(original, model)).to.deep.equal(
      cds.ql`
      SELECT from bookshop.Books as Books { Books.ID } where Books.ID = null
     `,
    )
  })
  it('replace `not in <empty array>` in where', () => {
    const original = SELECT.from('bookshop.Books').alias('Books').columns(['ID'])
    original.SELECT.where = [{ ref: ['ID'] }, 'not', 'in', { list: [] }]

    expect(cqn4sql(original, model)).to.deep.equal(
      cds.ql`
      SELECT from bookshop.Books as Books { Books.ID } where Books.ID is not null
     `,
    )
  })
  it('replace `in <empty array>` in join condition induced by infix filter', () => {
    const query = SELECT.from('bookshop.Books')
    .alias('Books')
    .columns({
      ref: [{ id: 'author', where: [{ ref: ['name'] }, 'not', 'in', { list: [] }] }, 'ID'],
    })

    expect(cqn4sql(query, model)).to.deep.equal(
      cds.ql`
      SELECT from bookshop.Books as Books
        left join bookshop.Authors as author
          on author.ID = Books.author_ID and author.name is not null
       { author.ID as author_ID }
     `,
    )
  })
  it('replace `in <empty array>` in where exists subquery induced by scoped query', () => {
    const query = SELECT.from({
      ref: [{ id: 'bookshop.Books', where: [{ ref: ['title'] }, 'not', 'in', { list: [] }] }, 'author'],
    }).columns({
      ref: ['ID'],
    })

    expect(cqn4sql(query, model)).to.deep.equal(
      cds.ql`
      SELECT from bookshop.Authors as $a
       { $a.ID }
       where exists (
        SELECT 1 from bookshop.Books as $B where $B.author_ID = $a.ID and $B.title is not null
       )
     `,
    )
  })
})
