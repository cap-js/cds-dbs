'use strict'

const cds = require('@sap/cds')
const inferred = require('../../lib/infer')
function _inferred(q, m = cds.model) {
  return inferred(q, m)
}

const { expect } = cds.test.in(__dirname + '/../bookshop')

describe('infer elements', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await await cds.load('db/schema').then(cds.linked)
  })

  describe('all query elements are linked', () => {
    it('expands and inlines are linked', () => {
      let query = cds.ql`SELECT from bookshop.Books {
        ID,
        author  as expandOnAssoc { * },
        dedication as expandOnStruct { * },
        author.{*},
        dedication.{*}
      }`
      let inferred = _inferred(query)
      Object.values(inferred.elements).forEach(e => {
        expect(e).to.be.an.instanceof(cds.type)
      })
    })
    it('values / functions / expr with type are linked', () => {
      let query = cds.ql`SELECT from bookshop.Books {
        1,
        true,
        'foo',
        3.14,
        1+1 as bar: cds.String,
        func(): cds.Integer,
      }`
      let inferred = _inferred(query)
      Object.values(inferred.elements).forEach(e => {
        expect(e).to.be.an.instanceof(cds.type)
      })
    })
  })

  it('element has the same name as the query alias', () => {
    let query = cds.ql`SELECT from bookshop.Books as dedication { ID, dedication.dedication.text }`
    let inferred = _inferred(query)
    let { Books } = model.entities
    expect(inferred.elements).to.deep.equal({
      ID: Books.elements.ID,
      dedication_text: Books.elements.dedication.elements.text,
    })
  })

  it('infer inferred query multiple times', () => {
    let query = cds.ql`SELECT from bookshop.Books as dedication { ID, dedication.dedication.text }`
    let inferred = _inferred(query)
    let inferredInferred = _inferred(inferred)
    expect(inferred).to.eql(inferredInferred)
  })

  it('infer inferred query multiple times, even after manipulation', () => {
    const flatModel = cds.compile.for.nodejs(model)
    // the order by path is join relevant
    let query = cds.ql`SELECT from bookshop.Genres { ID, parent_ID } order by parent.name`
    let inferred = _inferred(query, flatModel)
    /*
    now the order by path is not join relevant anymore
    if the orderBy's $refLinks are not properly re-constructed
    the reference looks like it induces a join while navigating along an exposed association
    which is generally not possible:

    entity V as select from Books {
      ID,
      author
    } order by author.name;
    --> "Error[ref-invalid-navigation]: Can follow managed association “V:author” only to the keys of its target, not to “name”"
    */
    inferred.SELECT.orderBy[0].ref = ['parent_ID']
    let inferredInferred = _inferred(inferred, flatModel)
    expect(inferred).to.eql(inferredInferred)
  })

  it('infer without global cds.model', () => {
    // this would trigger "Error: Please specify a model" if recursive infer calls would not pass down model parameter
    const keepModel = cds.model
    cds.model = null
    // subsequent infer calls should always use explicitly passed model parameter
    let query = cds.ql`SELECT from bookshop.Books { ID, (SELECT from bookshop.Books) as triggerRecursiveInfer }`
    let inferred = _inferred(query, model)
    let { Books } = model.entities
    expect(inferred.elements).to.deep.equal({
      ID: Books.elements.ID,
      triggerRecursiveInfer: {},
    })
    cds.model = keepModel
  })
})
