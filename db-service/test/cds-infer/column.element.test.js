'use strict'
// for convenience, we attach a non-enumerable property 'element' onto each column
// this property holds either the corresponding csn definition to which the column refers
// or an object - potentially with type information - for expressions or values.

const cds = require('@sap/cds/lib')

const { expect } = cds.test.in(__dirname + '/../bookshop') // IMPORTANT: that has to go before the requires below to avoid loading cds.env before cds.test()
const cqn4sql = require('../../lib/cqn4sql')
const inferred = require('../../lib/infer')
function _inferred(q, m = cds.model) {
  return inferred(q, m)
}

describe('assign element onto columns', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await await cds.load('db/schema').then(cds.linked)
  })

  describe('assigns element property for path expressions', () => {
    it('along simple association', () => {
      let query = CQL`SELECT from bookshop.Books { ID, currency.code }`
      let inferred = _inferred(query)
      let { Books } = model.entities
      // ID
      expect(inferred.SELECT.columns[0].element).to.deep.equal(inferred.elements['ID']).to.deep.equal(Books.elements.ID)
      // currency_code
      expect(inferred.SELECT.columns[1].element)
        .to.deep.equal(inferred.elements['currency_code'])
        .to.deep.equal(Books.elements.currency._target.elements.code)
    })

    it('with filter conditions', () => {
      let query = CQL`SELECT from bookshop.Books { dedication.addressee[placeOfBirth <> 'foo'].name, dedication.addressee.name as nameWithoutFilter }`
      let inferred = _inferred(query)
      let { Books } = model.entities
      // dedication_addressee_name
      expect(inferred.SELECT.columns[0].element)
        .to.deep.equal(inferred.elements['dedication_addressee_name'])
        .to.deep.equal(Books.elements.dedication.elements.addressee._target.elements.name)
      // nameWithoutFilter
      expect(inferred.SELECT.columns[1].element)
        .to.deep.equal(inferred.elements['nameWithoutFilter'])
        .to.deep.equal(Books.elements.dedication.elements.addressee._target.elements.name)
    })
  })

  describe('literals', () => {
    it('should allow selecting simple literal values', () => {
      const inferred = _inferred(CQL`
        SELECT 11, 'foo', true, false from bookshop.Books
      `)
      // '11'
      expect(inferred.SELECT.columns[0].element)
        .to.deep.equal(inferred.elements['11'])
        .to.deep.equal({ type: 'cds.Integer' })
      // 'foo'
      expect(inferred.SELECT.columns[1].element)
        .to.deep.equal(inferred.elements['foo'])
        .to.deep.equal({ type: 'cds.String' })
      // 'true'
      expect(inferred.SELECT.columns[2].element)
        .to.deep.equal(inferred.elements['true'])
        .to.deep.equal({ type: 'cds.Boolean' })
      // 'foo'
      expect(inferred.SELECT.columns[3].element)
        .to.deep.equal(inferred.elements['false'])
        .to.deep.equal({ type: 'cds.Boolean' })
    })
  })

  describe('virtual', () => {
    it("infers a query's virtual elements", () => {
      let query = CQL`SELECT from bookshop.Foo { ID, virtualField }`
      let inferred = _inferred(query)
      let { Foo } = model.entities
      expect(inferred.elements).to.deep.equal({
        ID: Foo.elements.ID,
        virtualField: Foo.elements.virtualField,
      })
      // 'ID'
      expect(inferred.SELECT.columns[0].element).to.deep.equal(inferred.elements['ID']).to.deep.equal(Foo.elements.ID)
      // 'virtualField'
      expect(inferred.SELECT.columns[1].element)
        .to.deep.equal(inferred.elements['virtualField'])
        .to.deep.equal(Foo.elements.virtualField)
    })
  })

  describe('scoped queries', () => {
    it('use table alias of scoped query (assoc defined via type reference)', () => {
      let inferred = _inferred(CQL`SELECT from bookshop.Books:coAuthor {
      coAuthor.name as name
    }`)
      let { Authors } = model.entities

      expect(inferred.elements).to.deep.equal({
        name: Authors.elements.name,
      })
      // 'name'
      expect(inferred.SELECT.columns[0].element)
        .to.deep.equal(inferred.elements['name'])
        .to.deep.equal(Authors.elements.name)
    })
  })
  describe('subqueries', () => {
    it('supports expressions and subqueries in the select list', () => {
      let query = CQL`
    SELECT from bookshop.Books {
      1 + 1 as Two,
      (select from bookshop.Authors { name }) as subquery
    }`
      let inferred = cqn4sql(query, model) // cqn4sql will trigger recursive infer
      let inferredSubquery = inferred.SELECT.columns[1]

      let { Authors } = model.entities

      // 'Two'
      expect(inferred.SELECT.columns[0].element).to.deep.equal(inferred.elements['Two']).to.deep.equal({})
      // 'subquery'
      expect(inferred.SELECT.columns[1].element).to.deep.equal(inferred.elements['subquery']).to.deep.equal({})
      // subquery: 'name'
      expect(inferredSubquery.SELECT.columns[0].element)
        .to.deep.equal(inferredSubquery.elements['name'])
        .to.deep.equal(Authors.elements.name)
    })
  })
  describe('expressions', () => {
    it('anonymous functions are inferred by their func property name', () => {
      let functionWithoutAlias = CQL`SELECT from bookshop.Books { sum(1 + 1), count(*) }`
      const inferred = _inferred(functionWithoutAlias)
      // 'sum'
      expect(inferred.SELECT.columns[0].element).to.deep.equal(inferred.elements['sum']).to.deep.equal({})
      // 'count'
      expect(inferred.SELECT.columns[1].element).to.deep.equal(inferred.elements['count']).to.deep.equal({})
    })

    it('supports an expression with fields in the select list', () => {
      let query = CQL`SELECT from bookshop.Books { title + descr as noType }`
      let inferred = _inferred(query)
      // 'noType'
      expect(inferred.SELECT.columns[0].element).to.deep.equal(inferred.elements['noType']).to.deep.equal({})
    })
  })

  describe('casts', () => {
    // revisit: precision / scale / length are not properly parsed
    it('simple values, cdl style cast', () => {
      let query = CQL(`SELECT from bookshop.Books {
      3.1415 as pid : cds.Decimal(5,4),
    }`)
      let inferred = _inferred(query)
      // 'pid'
      expect(inferred.SELECT.columns[0].element)
        .to.deep.equal(inferred.elements['pid'])
        .to.deep.equal({ type: 'cds.Decimal' /* , precision: 5, scale: 4 */ })
    })

    it('supports a cast expression in the select list', () => {
      let query = CQL`SELECT from bookshop.Books {
        cast(cast(ID as Integer) as String) as IDS,
        cast(ID as bookshop.DerivedFromDerivedString) as IDCustomType
      }`
      let inferred = _inferred(query)
      // 'IDS'
      expect(inferred.SELECT.columns[0].element)
        .to.deep.equal(inferred.elements['IDS'])
        .to.deep.equal({ type: 'cds.String' })
      // 'IDCustomType'
      expect(inferred.SELECT.columns[1].element)
        .to.deep.equal(inferred.elements['IDCustomType'])
        .to.deep.equal({ type: 'bookshop.DerivedFromDerivedString' })
    })

    it('supports a cdl-style cast in the select list', () => {
      let query = CQL`
        SELECT from bookshop.Books {
          dedication.sub.foo: Integer,
          ID as IDS: String,
          ID as IDCustomType: bookshop.DerivedFromDerivedString
        }`
      let inferred = _inferred(query)
      // revisit: what should the element be?
      // a: element "foo" with type string? -> ignore cast
      // (currently) b: object with type cds:integer? -> ignore the ref
      expect(inferred.SELECT.columns[0].element)
        .to.deep.equal(inferred.elements['dedication_sub_foo'])
        .to.deep.equal({ type: 'cds.Integer' })
      // 'IDS'
      expect(inferred.SELECT.columns[1].element)
        .to.deep.equal(inferred.elements['IDS'])
        .to.deep.equal({ type: 'cds.String' })
      // 'IDCustomType'
      expect(inferred.SELECT.columns[2].element)
        .to.deep.equal(inferred.elements['IDCustomType'])
        .to.deep.equal({ type: 'bookshop.DerivedFromDerivedString' })
    })
  })

  describe('pseudo variables', () => {
    it('$variables are inferred as query elements', () => {
      const pseudos = {
        elements: {
          $user: {
            elements: {
              id: { type: 'cds.String' },
              locale: { type: 'cds.String' }, // deprecated
              tenant: { type: 'cds.String' }, // deprecated
            },
          },
        },
      }
      let query = CQL`SELECT from bookshop.Bar {
        $user,
        $user.tenant,
        $user.unknown.foo.bar,
      }`
      let inferred = _inferred(query)
      // '$user'
      expect(inferred.SELECT.columns[0].element)
        .to.deep.equal(inferred.elements['$user'])
        .to.deep.equal(pseudos.elements.$user.elements.id)
      // '$user_tenant'
      expect(inferred.SELECT.columns[1].element)
        .to.deep.equal(inferred.elements['$user_tenant'])
        .to.deep.equal(pseudos.elements.$user.elements.tenant)
      // '$user_unknown_foo_bar'
      expect(inferred.SELECT.columns[2].element)
        .to.deep.equal(inferred.elements['$user_unknown_foo_bar'])
        .to.deep.equal({})
    })
  })

  describe('binding params', () => {
    it('put binding parameter into query elements as empty object', () => {
      const query = CQL`
        SELECT from bookshop.Books {
          ID,
          ? as discount
        }
      `
      const inferred = _inferred(query, model)
      // 'discount'
      expect(inferred.SELECT.columns[1].element).to.deep.equal(inferred.elements['discount']).to.deep.equal({})
    })
    it('respect cast type on binding parameter', () => {
      const query = CQL`
        SELECT from bookshop.Books {
          ID,
          ? as discount: Integer
        }
      `
      const inferred = _inferred(query, model)
      // 'discount'
      expect(inferred.SELECT.columns[1].element)
        .to.deep.equal(inferred.elements['discount'])
        .to.deep.equal({ type: 'cds.Integer' })
    })
    it('infers values type on binding parameter', () => {
      const query = {
        SELECT: {
          columns: [{ ref: ['ID'] }, { ref: ['?'], param: true, as: 'discount', val: 42 }],
          from: { ref: ['bookshop.Books'] },
          where: [{ ref: ['ID'] }, '=', { ref: ['?'], param: true }],
        },
      }
      const inferred = _inferred(query, model)
      // 'discount'
      expect(inferred.SELECT.columns[1].element)
        .to.deep.equal(inferred.elements['discount'])
        .to.deep.equal({ type: 'cds.Integer' })
    })
  })
})
