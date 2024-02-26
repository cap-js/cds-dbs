'use strict'
// test the calculation of the sources of the query

const cds = require('@sap/cds/lib')
const { expect } = cds.test.in(__dirname + '/../bookshop')
const inferred = require('../../lib/infer')
function _inferred(q, m = cds.model) {
  return inferred(q, m)
}

describe('simple', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  it('infer single source', () => {
    let query = CQL`SELECT from bookshop.Books { ID, author }`
    let inferred = _inferred(query)
    expect(inferred).to.deep.equal(query)
    expect(inferred).to.have.property('target')
    expect(inferred).to.have.property('elements')
    let { Books } = model.entities
    expect(inferred.target).to.deep.equal(Books)
    expect(inferred.elements).to.deep.equal({
      ID: Books.elements.ID,
      author: Books.elements.author,
    })
    expect(Object.keys(inferred.elements)).to.have.lengthOf(query.SELECT.columns.length)
  })

  it('infer source for UPDATE, DELETE and INSERT', () => {
    const { UPDATE, INSERT, DELETE } = cds.ql
    let u = UPDATE.entity`bookshop.Books:author`.set`name = 'foo'`
    let i = INSERT.into`bookshop.Books`.entries({ ID: 201 })
    let d = DELETE.from('bookshop.Books').where({ stock: { '<': 1 } })
    let { Authors, Books } = model.entities
    expect(_inferred(u)).to.have.property('target').that.equals(Authors)
    expect(_inferred(i)).to.have.property('target').that.equals(Books)
    expect(_inferred(d)).to.have.property('target').that.equals(Books)
  })
})
describe('scoped queries', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  it('select from association', () => {
    let query = CQL`SELECT from bookshop.Books:author { ID }`
    let inferred = _inferred(query)

    let { Authors } = model.entities
    expect(inferred).to.have.nested.property('sources.author', Authors)
    expect(inferred.elements).to.deep.equal({
      ID: Authors.elements.ID,
    })
    expect(Object.keys(inferred.elements)).to.have.lengthOf(query.SELECT.columns.length)
  })
  it('navigate along multiple assocs', () => {
    let query = CQL`SELECT from bookshop.Books:author.books`
    let inferred = _inferred(query)
    let { Books } = model.entities
    expect(inferred).to.have.nested.property('sources.books', Books)
  })
  it('multiple assocs with filter', () => {
    let query = CQL`SELECT from bookshop.Books[201]:author[111].books`
    let inferred = _inferred(query)
    let { Books } = model.entities
    expect(inferred).to.have.nested.property('sources.books', Books)
  })
})
describe('subqueries', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  it('subquery in from', () => {
    let query = CQL`SELECT from (select from bookshop.Books { ID as barID }) as Bar { barID }`
    let inferred = _inferred(query)

    let { Books } = model.entities
    expect(inferred).to.have.nested.property('sources.Bar.sources.Books', Books)
    expect(inferred.elements).to.deep.equal({
      barID: Books.elements.ID,
    })
    expect(Object.keys(inferred.elements)).to.have.lengthOf(query.SELECT.columns.length)
  })

  it('subquery in from with wildcard', () => {
    let query = CQL`SELECT from (select from bookshop.Books) as Bar { ID, author }`
    let inferred = _inferred(query)

    let { Books } = model.entities
    expect(inferred.sources).to.have.nested.property('Bar.sources.Books', Books)
    expect(inferred.elements).to.deep.equal({
      ID: Books.elements.ID,
      author: Books.elements.author,
    })
    expect(Object.keys(inferred.elements)).to.have.lengthOf(query.SELECT.columns.length)
  })
})

describe('multiple sources', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })
  it('infers multiple table aliases as the queries source with a simple cross join', () => {
    let inferred = _inferred(CQL`
    SELECT from bookshop.Books:author as A, bookshop.Books {
      A.ID as aID,
      Books.ID as bID,
      Books.author.name as authorName
    }`)
    let { Books, Authors } = model.entities

    expect(inferred.target).to.deep.equal(inferred)

    expect(inferred.elements).to.deep.equal({
      aID: Authors.elements.ID,
      bID: Books.elements.ID,
      authorName: Authors.elements.name,
    })
  })

  it('infers multiple table aliases as the queries source with a nested join', () => {
    let inferred = _inferred(CQL`
    SELECT from bookshop.Books:author as Authors join bookshop.Books on 1 = 1 join bookshop.Foo on 1 = 1 {
      Authors.ID as aID,
      Books.ID as bID,
      Foo.ID as fooID
    }`)
    let { Authors, Books, Foo } = model.entities

    expect(inferred.elements).to.deep.equal({
      aID: Authors.elements.ID,
      bID: Books.elements.ID,
      fooID: Foo.elements.ID,
    })
  })

  it('infers multiple table aliases for the same query source if aliases differ', () => {
    let inferred = _inferred(CQL`
    SELECT from bookshop.Books as firstBook, bookshop.Books as secondBook {
      firstBook.ID as firstBookID,
      secondBook.ID as secondBookID
    }`)
    let { Books } = model.entities

    // same base entity, addressable via both aliases
    expect(inferred.target).to.deep.equal(inferred)
    expect(inferred.sources['firstBook']).to.deep.equal(inferred.sources['secondBook']).to.deep.equal(Books)

    expect(inferred.elements).to.deep.equal({
      firstBookID: Books.elements.ID,
      secondBookID: Books.elements.ID,
    })
  })
})
