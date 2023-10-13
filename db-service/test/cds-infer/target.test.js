const cds = require('@sap/cds/lib')
const { any } = require('@sap/cds/lib/linked/classes')
const { expect } = cds.test.in(__dirname + '/../bookshop')

let model; beforeAll(() => cds.load('db/schema').then(csn => model = cds.linked(csn)))

describe('without cds.model', () => {

  beforeAll(() => cds.model = undefined)

  describe('query.target', () => {

    it('should be _unresolved', () => {
      let query = SELECT.from('bookshop.Books')
      expect(query._target).to.deep.equal({ name: 'bookshop.Books' })
      expect(query._target).not.to.be.an.instanceof(cds.entity)
      expect(query.target).to.deep.equal({ name: 'bookshop.Books', _unresolved: true })
      expect(query.target).to.be.an.instanceof(cds.entity)
      // query._target didn't change
      expect(query._target).not.to.equal(query.target)
      expect(query._target).to.deep.equal({ name: 'bookshop.Books' })
      expect(query._target).not.to.be.an.instanceof(cds.entity)
    })

  })

  describe('query.elements', () => {

    it('are undefined when no columns specified', () => {
      let query = SELECT.from('bookshop.Books')
      expect(query.elements).to.be.undefined
    })

    it('are resolved from specified columns', () => {
      let query = SELECT.from('bookshop.Books').columns `foo, bar : Integer`
      expect(query.elements).to.deep.equal({
        foo: {},
        bar: { type: 'cds.Integer' },
      })
      expect(query.elements.foo.type).to.be.undefined
      expect(query.elements.foo).to.be.instanceof(cds.type)
      expect(query.elements.bar).to.be.instanceof(cds.builtin.classes.number)
    })

  })

})

describe('with cds.model', () => {

  beforeAll(() => cds.model = model)

  describe('query.target', () => {

    it('should be _unresolved for unknown entities', () => {
      cds.model = model
      let query = SELECT.from('sqlite.schema')
      expect(query._target).to.deep.equal({ name: 'sqlite.schema' })
      expect(query._target).not.to.be.an.instanceof(cds.entity)
      // query.target calls cds.infer.target4 internally
      expect(query.target).to.deep.equal({ name: 'sqlite.schema', _unresolved: true })
      expect(query.target).to.be.an.instanceof(cds.entity)
      // query._target changed to resolved entity after cds.infer
      expect(query._target).to.equal(query.target)
    })

    it('should be resolved for known entities', () => {
      cds.model = model
      let query = SELECT.from('bookshop.Books')
      expect(query._target).to.deep.equal({ name: 'bookshop.Books' })
      expect(query._target).not.to.be.an.instanceof(cds.entity)
      // query.target calls cds.infer.target4 internally
      expect(query.target).to.equal(model.entities.Books)
      // query._target changed to resolved entity after cds.infer
      expect(query._target).to.equal(query.target)
    })

  })


  describe('query.elements', () => {

    it('are the target entities elements when no columns specified', () => {
      let query = SELECT.from('bookshop.Books')
      expect(query.elements).to.equal(query.target.elements)
    })

    it('are resolved from target entity elements when columns are specified', () => {

      let query = SELECT.from('bookshop.Books').columns `ID as id, title, author.name, stock : String`
      let { Books, Authors } = cds.entities

      expect(query.elements).not.to.equal(query.target.elements)
      expect(query.elements).to.deep.equal({
        id: Books.elements.ID,
        title: Books.elements.title,
        author_name: Authors.elements.name,
        stock: { type: 'cds.String' }, // type not taken from Books.elements.stock
      })

      const { id, title, author_name, stock } = query.elements
      expect(id).to.equal(Books.elements.ID)
      expect(title).to.equal(Books.elements.title)
      expect(author_name).to.equal(Authors.elements.name)
      expect(stock).to.not.equal(Books.elements.stock) //> NOT!

      // All inferred elements are instances of cds.type
      expect(id).to.be.instanceof(cds.type)
      expect(title).to.be.instanceof(cds.type)
      expect(author_name).to.be.instanceof(cds.type)
      expect(stock).to.be.instanceof(cds.type)

      // More precisely of subclasses thereof
      const { string, number } = cds.builtin.classes
      expect(id).to.be.instanceof(number)
      expect(title).to.be.instanceof(string)
      expect(author_name).to.be.instanceof(string)
      expect(stock).to.be.instanceof(string)
    })

  })

})


describe('infer elements', () => {

  beforeAll(() => cds.model = model)

  describe('all query elements are linked', () => {

    it('expands and inlines are linked', () => {
      let query = SELECT.from('bookshop.Books').columns `{
        ID,
        author  as expandOnAssoc { * },
        dedication as expandOnStruct { * },
        author.{*},
        dedication.{*}
      }`
      Object.values(query.elements).forEach(e => {
        expect(e).to.be.an.instanceof(cds.type)
      })
    })

    it('values / functions / expr with type are linked', () => {
      let query = SELECT.from('bookshop.Books').columns `{
        1,
        true,
        'foo',
        3.14,
        1+1 as bar: cds.String,
        func(): cds.Integer,
      }`
      Object.values(query.elements).forEach(e => {
        expect(e).to.be.an.instanceof(cds.type)
      })
    })
  })

  it('element has the same name as the query alias', () => {
    let query = SELECT.from('bookshop.Books').columns `{ ID, dedication.text }`
    let { ID, dedication } = cds.entities.Books.elements
    expect(query.elements).to.deep.equal({
      ID,
      dedication_text: dedication.elements.text,
    })
  })

  it('infer without global cds.model', () => {
    // this would trigger "Error: Please specify a model" if recursive cds.infer calls would not pass down model parameter
    const keepModel = cds.model
    cds.model = null
    // subsequent cds.infer calls should always use explicitly passed model parameter
    let query = SELECT.from('bookshop.Books').columns `{ ID, (SELECT from bookshop.Books) as triggerRecursiveInfer }`
    let { any, struct, array } = cds.builtin.types
    expect(query.elements).to.deep.equal({
      ID: any,
      triggerRecursiveInfer: array,
    })
    cds.model = keepModel
  })
})
