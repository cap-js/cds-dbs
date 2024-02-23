'use strict'
// for convenience, we attach a non-enumerable property 'element' onto each column with a ref
// this property holds the corresponding csn definition to which the column refers

const cds = require('@sap/cds/lib')

const { expect } = cds.test.in(__dirname + '/../bookshop') // IMPORTANT: that has to go before the requires below to avoid loading cds.env before cds.test()
const cqn4sql = require('../../lib/cqn4sql')
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
    `, model)
    const expected = CQL`SELECT from bookshop.Books as Books {
        Books.ID,
        Books.author_ID,
        Books.dedication_addressee_ID,
        Books.dedication_sub_foo
    }
    `
    const { Books } = model.entities
    expect(query).to.deep.eql(expected)
    expect(query.SELECT.columns[0]).to.have.property('element').that.equals(Books.elements['ID'])
    expect(query.SELECT.columns[1]).to.have.property('element').that.equals(Books.elements.author._target.elements.ID) // this is a structured model -> no fk in "Books"
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
    `, model)
    const { Authors } = model.entities
    expect(query.SELECT.columns[0].SELECT.columns[0]).to.have.property('element').that.equals(Authors.elements['name'])
  })
  it('attaches the `element` to functions, xpr and val', () => {
    let query = cqn4sql(CQL`
      SELECT from bookshop.Books {
        1 as val,
        1 + 1 as xpr,
        func(),
        (SELECT from bookshop.Books) as subquery: cds.String
      }
    `, model)
    expect(query.SELECT.columns[0]).to.have.property('element').that.is.an.instanceof(cds.type) // has cds.Integer type inferred
    expect(query.SELECT.columns[1]).to.have.property('element')
    expect(query.SELECT.columns[2]).to.have.property('element')
    expect(query.SELECT.columns[3]).to.have.property('element').that.is.an.instanceof(cds.type) // has cds.String information through cast
  })
})

describe('assign element onto columns with flat model', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load('db/schema').then(cds.linked)
    model = cds.compile.for.nodejs(JSON.parse(JSON.stringify(model)))
  })

  it('foreign key is adjacent to its association in flat model', () => {
    let query = cqn4sql(CQL`
      SELECT from bookshop.Books {
        ID,
        author
      }
    `, model)
    const expected = CQL`SELECT from bookshop.Books as Books {
        Books.ID,
        Books.author_ID
    }
    `
    const { Books } = model.entities
    expect(query).to.deep.eql(expected)
    expect(query.SELECT.columns[0]).to.have.property('element').that.eqls(Books.elements.ID)
    // foreign key is part of flat model
    expect(query.SELECT.columns[1]).to.have.property('element').that.eqls(Books.elements.author_ID)
  })
  it('within expand, the key in the target is attached, not the foreign key', () => {
    let query = cqn4sql(CQL`
      SELECT from bookshop.Books {
        ID,
        author {
          ID
        }
      }
    `, model)
    const expected = CQL`SELECT from bookshop.Books as Books {
        Books.ID,
        (SELECT from bookshop.Authors as author {
          author.ID
        } where Books.author_ID = author.ID) as author
    }
    `
    const { Authors } = model.entities
    expect(JSON.parse(JSON.stringify(query))).to.deep.eql(expected)

    expect(query.SELECT.columns[1].SELECT.columns[0]).to.have.property('element').that.eqls(Authors.elements.ID)
  })

  it('foreign key is adjacent to its association in flat model with multiple foreign keys', () => {
    let query = cqn4sql(CQL`
      SELECT from bookshop.AssocWithStructuredKey {
        ID,
        toStructuredKey
      }
    `, model)
    const expected = CQL`SELECT from bookshop.AssocWithStructuredKey as AssocWithStructuredKey {
        AssocWithStructuredKey.ID,
        AssocWithStructuredKey.toStructuredKey_struct_mid_leaf,
        AssocWithStructuredKey.toStructuredKey_struct_mid_anotherLeaf,

        AssocWithStructuredKey.toStructuredKey_second
    }
    `
    const { AssocWithStructuredKey } = model.entities
    expect(query).to.deep.eql(expected)
    expect(query.SELECT.columns[0]).to.have.property('element').that.eqls(AssocWithStructuredKey.elements.ID)
    // foreign key is part of flat model
    if(model.meta.unfolded) { //> REVISIT: Remove once unfolded csn is standard
      expect(query.SELECT.columns[1]).to.have.property('element').that.eqls(AssocWithStructuredKey.elements.toStructuredKey_struct_mid_leaf.__proto__)
      expect(query.SELECT.columns[2]).to.have.property('element').that.eqls(AssocWithStructuredKey.elements.toStructuredKey_struct_mid_anotherLeaf.__proto__)
    } else {
      expect(query.SELECT.columns[1]).to.have.property('element').that.eqls(AssocWithStructuredKey.elements.toStructuredKey_struct_mid_leaf)
      expect(query.SELECT.columns[2]).to.have.property('element').that.eqls(AssocWithStructuredKey.elements.toStructuredKey_struct_mid_anotherLeaf)  
    }


    expect(query.SELECT.columns[3]).to.have.property('element').that.eqls(AssocWithStructuredKey.elements.toStructuredKey_second)
  })

  it('foreign key is adjacent to its association in flat model and is renamed', () => {
    let query = cqn4sql(CQL`
      SELECT from bookshop.TestPublisher {
        ID,
        publisherRenamedKey
      }
    `, model)
    // structured key is renamed in model:
    // --> `key publisherRenamedKey : Association to Publisher { structuredKey.ID as notID };`
    const expected = CQL`SELECT from bookshop.TestPublisher as TestPublisher {
        TestPublisher.ID,
        TestPublisher.publisherRenamedKey_notID
    }
    `
    const { TestPublisher } = model.entities
    expect(query).to.deep.eql(expected)
    expect(query.SELECT.columns[0]).to.have.property('element').that.eqls(TestPublisher.elements.ID)
    // foreign key is part of flat model
    expect(query.SELECT.columns[1]).to.have.property('element').that.eqls(TestPublisher.elements.publisherRenamedKey_notID)
  })
})
