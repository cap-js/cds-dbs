// here we can collect features which are not (yet) supported
'use strict'
const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds')
const { expect } = cds.test
const _inferred = require('../../lib/infer')

describe('not supported features', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  it('does not transform queries with multiple query sources, but just returns the inferred query', () => {
    let query = cds.ql`SELECT from bookshop.Books, bookshop.Receipt`
    expect(cqn4sql(query, model)).to.deep.equal(_inferred(query, model))
    // .to.throw(/Queries with multiple query sources are not supported/)
  })

  it('rejects excessively nested expressions instead of overflowing the stack', () => {
    // deeply nested parens (e.g. crafted OData `$filter`) become nested `xpr`s
    let inner = { xpr: [{ ref: ['ID'] }, '=', { val: 1 }] }
    for (let i = 0; i < 3000; i++) inner = { xpr: [inner] }
    const query = cds.ql`SELECT from bookshop.Books`
    query.SELECT.where = [inner]
    expect(() => cqn4sql(query, model)).to.throw(/nesting depth/)
  })

  it('rejects deeply nested subqueries instead of overflowing the stack', () => {
    const query = nestedSubqueries(5000)
    expect(() => cqn4sql(query, model)).to.throw(/nesting depth/)
  })

  it('rejects excessively long association paths instead of overflowing the stack', () => {
    // path length is request-controlled: books.author.books.author.…name
    const ref = []
    for (let i = 0; i < 5000; i++) ref.push(i % 2 === 0 ? 'books' : 'author')
    ref.push('name')
    const query = { SELECT: { from: { ref: ['bookshop.Authors'] }, columns: [{ ref }] } }
    expect(() => cqn4sql(query, model)).to.throw(/nesting depth/)
  })

  it('rejects deeply nested inline projections instead of overflowing the stack', () => {
    // nested inline/expand on struct is request-controlled
    let col = { ref: ['author'], inline: [{ ref: ['ID'] }] }
    for (let i = 0; i < 500; i++) col = { ref: i % 2 ? ['author'] : ['books'], inline: [col] }
    const query = { SELECT: { from: { ref: ['bookshop.Authors'] }, columns: [{ ref: ['books'], inline: [col] }] } }
    expect(() => cqn4sql(query, model)).to.throw(/nesting depth/)
  })

  it('rejects deeply nested function args instead of overflowing the stack', () => {
    let fn = { func: 'lower', args: [{ val: 'x' }] }
    for (let i = 0; i < 5000; i++) fn = { func: 'lower', args: [fn] }
    const query = { SELECT: { from: { ref: ['bookshop.Books'] }, columns: [{ ref: ['ID'] }], where: [fn, '=', { val: 'x' }] } }
    expect(() => cqn4sql(query, model)).to.throw(/nesting depth/)
  })

  it('rejects deeply nested lists instead of overflowing the stack', () => {
    let list = { list: [{ val: 1 }] }
    for (let i = 0; i < 5000; i++) list = { list: [list] }
    const query = { SELECT: { from: { ref: ['bookshop.Books'] }, columns: [{ ref: ['ID'] }], where: [{ ref: ['ID'] }, 'in', list] } }
    expect(() => cqn4sql(query, model)).to.throw(/nesting depth/)
  })

  function nestedSubqueries(depth) {
    let inner = { SELECT: { from: { ref: ['bookshop.Books'] }, columns: [{ ref: ['ID'] }] } }
    for (let i = 0; i < depth; i++) {
      inner = {
        SELECT: {
          from: { ref: ['bookshop.Books'] },
          columns: [{ ref: ['ID'] }],
          where: [{ ref: ['ID'] }, 'in', inner],
        },
      }
    }
    return inner
  }
})
