'use strict'
// for convenience, we attach a non-enumerable property 'element' onto each column with a ref
// this property holds the corresponding csn definition to which the column refers

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds/lib')
const { expect } = cds.test.in(__dirname+'/../bookshop')

describe('assign element onto columns', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load('db/schema').then(cds.linked)
  })

  it('attaches the `element` to simple / structured columns', () => {
    let query = cqn4sql(CQL`
      SELECT from bookshop.Books {
        ID,
        author,
        dedication.addressee,
        dedication.sub
      }
    `)
    const expected = CQL`SELECT from bookshop.Books as Books {
        Books.ID,
        Books.author_ID,
        Books.dedication_addressee_ID,
        Books.dedication_sub_foo
    }
    `
    const {Books} = model.entities
    expect(query).to.deep.eql(expected)
    expect(query.SELECT.columns[0])
      .to.have.property('element')
      .that.equals(Books.elements['ID'])
    expect(query.SELECT.columns[1])
      .to.have.property('element')
      .that.equals(Books.elements.author._target.elements.ID) // this is a structured model -> no fk in "Books"
    expect(query.SELECT.columns[2])
      .to.have.property('element')
      .that.equals(Books.elements.dedication.elements.addressee._target.elements.ID) // this is a structured model -> no fk in "Books"
    expect(query.SELECT.columns[3])
      .to.have.property('element')
      .that.equals(Books.elements.dedication.elements.sub.elements.foo)
  })
  it('attaches the `element` to expand subquery columns', () => {
    let query = cqn4sql(CQL`
      SELECT from bookshop.Books {
        author { name }
      }
    `)
    const {Authors} = model.entities
    expect(query.SELECT.columns[0].SELECT.columns[0])
      .to.have.property('element')
      .that.equals(Authors.elements['name'])
  })
  it('attaches the `element` to functions, xpr and val', () => {
    let query = cqn4sql(CQL`
      SELECT from bookshop.Books {
        1 as val,
        1 + 1 as xpr,
        func(),
        (SELECT from bookshop.Books) as subquery: cds.String
      }
    `)
    expect(query.SELECT.columns[0])
      .to.have.property('element')
      .that.is.an.instanceof(cds.type) // has cds.Integer type inferred
    expect(query.SELECT.columns[1])
      .to.have.property('element')
    expect(query.SELECT.columns[2])
      .to.have.property('element')
    expect(query.SELECT.columns[3])
      .to.have.property('element')
      .that.is.an.instanceof(cds.type) // has cds.String information through cast
  })
})
