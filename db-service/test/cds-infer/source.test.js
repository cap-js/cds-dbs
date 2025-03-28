'use strict'
// test the calculation of the sources of the query

const cds = require('@sap/cds')
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
    let query = cds.ql`SELECT from bookshop.Books { ID, author }`
    let inferred = _inferred(query)
    expect(inferred).to.deep.equal(query)
    expect(inferred).to.have.property('_target')
    expect(inferred).to.have.property('elements')
    let { Books } = model.entities
    expect(inferred._target).to.deep.equal(Books)
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
    expect(_inferred(u)).to.have.property('_target').that.equals(Authors)
    expect(_inferred(i)).to.have.property('_target').that.equals(Books)
    expect(_inferred(d)).to.have.property('_target').that.equals(Books)
  })
})
describe('scoped queries', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  it('select from association', () => {
    let query = cds.ql`SELECT from bookshop.Books:author as author { ID }`
    let inferred = _inferred(query)

    let { Authors } = model.entities
    expect(inferred.sources).to.have.nested.property('author.definition', Authors)
    expect(inferred.elements).to.deep.equal({
      ID: Authors.elements.ID,
    })
    expect(Object.keys(inferred.elements)).to.have.lengthOf(query.SELECT.columns.length)
  })
  it('navigate along multiple assocs', () => {
    let query = cds.ql`SELECT from bookshop.Books:author.books as books`
    let inferred = _inferred(query)
    let { Books } = model.entities
    expect(inferred.sources).to.have.nested.property('books.definition', Books)
  })
  it('multiple assocs with filter', () => {
    let query = cds.ql`SELECT from bookshop.Books[201]:author[111].books as books`
    let inferred = _inferred(query)
    let { Books } = model.entities
    expect(inferred.sources).to.have.nested.property('books.definition', Books)
  })
})
describe('subqueries', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  it('subquery in from', () => {
    let query = cds.ql`SELECT from (select from bookshop.Books as Books { ID as barID }) as Bar { barID }`
    let inferred = _inferred(query)

    let { Books } = model.entities
    expect(inferred.sources).to.have.nested.property('Bar.definition.sources.Books.definition', Books)
    expect(inferred.elements).to.deep.equal({
      barID: Books.elements.ID,
    })
    expect(Object.keys(inferred.elements)).to.have.lengthOf(query.SELECT.columns.length)
  })

  it('subquery in from with wildcard', () => {
    let query = cds.ql`SELECT from (select from bookshop.Books as Books) as Bar { ID, author }`
    let inferred = _inferred(query)

    let { Books } = model.entities
    expect(inferred.sources).to.have.nested.property('Bar.definition.sources.Books.definition', Books)
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
    let inferred = _inferred(cds.ql`
    SELECT from bookshop.Books:author as A, bookshop.Books {
      A.ID as aID,
      Books.ID as bID,
      Books.author.name as authorName
    }`)
    let { Books, Authors } = model.entities

    expect(inferred._target).to.deep.equal(inferred)

    expect(inferred.elements).to.deep.equal({
      aID: Authors.elements.ID,
      bID: Books.elements.ID,
      authorName: Authors.elements.name,
    })
  })

  it('infers multiple table aliases as the queries source with a nested join', () => {
    let inferred = _inferred(cds.ql`
    SELECT from bookshop.Books:author as Authors join bookshop.Books as Books on 1 = 1 join bookshop.Foo As Foo on 1 = 1 {
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
    let inferred = _inferred(cds.ql`
    SELECT from bookshop.Books as firstBook, bookshop.Books as secondBook {
      firstBook.ID as firstBookID,
      secondBook.ID as secondBookID
    }`)
    let { Books } = model.entities

    // same base entity, addressable via both aliases
    expect(inferred._target).to.deep.equal(inferred)
    expect(inferred.sources['firstBook'].definition).to.deep.equal(inferred.sources['secondBook'].definition).to.deep.equal(Books)

    expect(inferred.elements).to.deep.equal({
      firstBookID: Books.elements.ID,
      secondBookID: Books.elements.ID,
    })
  })
})
