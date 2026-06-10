'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expect } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('table alias access - in function args', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql
    cqn4sql = q => orig(q, model)
  })

  it('function in filter in order by', () => {
    let query = cds.ql`
      SELECT ID
        from bookshop.Books as Books
        order by coAuthorUnmanaged[not (calculateName(ID) = 'King')].name
    `
    let expected = cds.ql`
      SELECT Books.ID from bookshop.Books as Books
        left join bookshop.Authors as coAuthorUnmanaged
          on coAuthorUnmanaged.ID = Books.coAuthor_ID_unmanaged and not (calculateName(coAuthorUnmanaged.ID) = 'King')
        order by coAuthorUnmanaged.name
    `

    let result = cqn4sql(query)
    expect(result).to.deep.equal(expected)
  })
  it('function in filter along path traversal', () => {
    // the `not` in front of `(name = 'King')` makes it an xpr
    // --> make sure we cover this path and prepend aliases
    let query = cds.ql`
      SELECT
          ID,
          coAuthorUnmanaged[not (calculateName(ID) = 'King')].name
        from bookshop.Books as Books
    `
    let expected = cds.ql`
      SELECT
          Books.ID,
          coAuthorUnmanaged.name as coAuthorUnmanaged_name
        from bookshop.Books as Books
        left join bookshop.Authors as coAuthorUnmanaged
          on coAuthorUnmanaged.ID = Books.coAuthor_ID_unmanaged and not (calculateName(coAuthorUnmanaged.ID) = 'King')
    `

    let result = cqn4sql(query)
    expect(result).to.deep.equal(expected)
  })

  it('refs in function args in on condition are aliased', () => {
    let query = cds.ql`
      SELECT
        ID,
        iSimilar { name }
      from bookshop.Posts as Posts `

    const expected = cds.ql`
      SELECT
        Posts.ID,
        (
          SELECT from bookshop.Posts as $i {
            $i.name
          }
          where UPPER(Posts.name) = UPPER($i.name)
        ) as iSimilar
      from bookshop.Posts as Posts`

    let result = cqn4sql(query)
    expect(JSON.parse(JSON.stringify(result))).to.deep.equal(expected)
  })
  it('refs in nested function args in on condition are aliased', () => {
    let query = cds.ql`
      SELECT
        ID,
        iSimilarNested { name }
      from bookshop.Posts as Posts`

    const expected = cds.ql`
      SELECT
        Posts.ID,
        (
          SELECT from bookshop.Posts as $i {
            $i.name
          }
          where UPPER($i.name) = UPPER(LOWER(UPPER(Posts.name)), Posts.name)
        ) as iSimilarNested
      from bookshop.Posts as Posts`

    let result = cqn4sql(query)
    expect(JSON.parse(JSON.stringify(result))).to.deep.equal(expected)
  })
})
