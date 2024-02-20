'use strict'
// test the calculation of the elements of the query

const cds = require('@sap/cds/lib')
const { expect } = cds.test.in(__dirname + '/../bookshop')
const inferred = require('../../lib/infer')
function _inferred(q, m = cds.model) {
  return inferred(q, m)
}

describe('infer elements', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  describe('path expressions', () => {
    it('along simple association', () => {
      let query = CQL`SELECT from bookshop.Books { ID, currency.code }`
      let inferred = _inferred(query)
      let { Books } = model.entities
      expect(inferred.elements).to.deep.equal({
        ID: Books.elements.ID,
        currency_code: Books.elements.currency._target.elements.code,
      })
    })

    it('along multiple associations', () => {
      let query = CQL`SELECT from bookshop.Books { ID, Books.genre.parent.ID }`
      let inferred = _inferred(query)
      let { Books } = model.entities
      expect(inferred.elements).to.deep.equal({
        ID: Books.elements.ID,
        genre_parent_ID: Books.elements.genre._target.elements.parent._target.elements.ID,
      })
    })

    it.skip('represents the formal correct behavior w.r.t. the name of the structured element', () => {
      let query = CQL`SELECT from bookshop.Books { ID, currency.code, dedication.text }`
      let inferred = _inferred(query)
      let { Books } = model.entities
      expect(inferred.elements).to.deep.equal({
        ID: Books.elements.ID,
        code: Books.elements.currency._target.elements.code,
        text: Books.elements.dedication.elements.text,
      })
    })

    it('along structs (name of element is ref.join("_"))', () => {
      let query = CQL`SELECT from bookshop.Books { ID, dedication.sub.foo, dedication.sub }`
      let inferred = _inferred(query)
      let { Books } = model.entities
      expect(inferred.elements).to.deep.equal({
        ID: Books.elements.ID,
        dedication_sub_foo: Books.elements.dedication.elements.sub.elements.foo,
        dedication_sub: Books.elements.dedication.elements.sub,
      })
    })
    it('with filter conditions', () => {
      let query = CQL`SELECT from bookshop.Books { dedication.addressee[placeOfBirth <> 'foo'].name, dedication.addressee.name as nameWithoutFilter }`
      let inferred = _inferred(query)
      let { Books } = model.entities
      expect(inferred.elements).to.deep.equal({
        dedication_addressee_name: Books.elements.dedication.elements.addressee._target.elements.name,
        nameWithoutFilter: Books.elements.dedication.elements.addressee._target.elements.name,
      })
    })
  })

  describe('literals', () => {
    it('should allow selecting simple literal values', () => {
      const inferred = _inferred(CQL`
        SELECT 11, 'foo', true, false from bookshop.Books
      `)
      expect(inferred.elements).to.deep.equal({
        11: { type: 'cds.Integer' },
        foo: { type: 'cds.String' },
        true: { type: 'cds.Boolean' },
        false: { type: 'cds.Boolean' },
      })
    })
  })

  describe('virtual and persistence skip', () => {
    it('infers a queries virtual elements', () => {
      let query = CQL`SELECT from bookshop.Foo { ID, virtualField }`
      let inferred = _inferred(query)
      let { Foo } = model.entities
      expect(inferred.elements).to.deep.equal({
        ID: Foo.elements.ID,
        virtualField: Foo.elements.virtualField,
      })
    })
    it('infers paths with ”@cds.persistence.skip” as query element', () => {
      const q = CQL`SELECT from bookshop.NotSkipped {
        ID,
        skipped.notSkipped.text as skippedPath
      }`
      let { NotSkipped } = model.entities
      let inferred = _inferred(q)
      expect(inferred.elements).to.deep.equal({
        ID: NotSkipped.elements.ID,
        skippedPath: NotSkipped.elements.skipped._target.elements.notSkipped._target.elements.text,
      })
    })
  })

  describe('everything but "columns" is not relevant for queries elements', () => {
    it('does not infer an element only used in a WHERE condition as the queries element', () => {
      let query = CQL`SELECT from bookshop.Books { ID } WHERE dedication.text = 'bar'`
      let inferred = _inferred(query)
      let { Books } = model.entities
      expect(inferred.elements).to.deep.equal({
        ID: Books.elements.ID,
      })
    })
  })

  describe('access elements via table alias', () => {
    it('implicit alias via entity name', () => {
      let query = CQL`SELECT from bookshop.Books { ID, Books.author }`
      let inferred = _inferred(query)
      let { Books } = model.entities
      expect(inferred.elements).to.deep.equal({
        ID: Books.elements.ID,
        author: Books.elements.author,
      })
    })

    it('user defined aliases', () => {
      let query = CQL`SELECT from bookshop.Books as Foo { ID as identifier, dedication.sub.foo as foo, Foo.dedication.sub as sub }`
      let inferred = _inferred(query)
      let { Books } = model.entities
      expect(inferred.elements).to.deep.equal({
        identifier: Books.elements.ID,
        foo: Books.elements.dedication.elements.sub.elements.foo,
        sub: Books.elements.dedication.elements.sub,
      })
    })
    it('query alias shadows an element name', () => {
      let query = CQL`SELECT from bookshop.Books as dedication { ID, dedication, dedication.title, dedication.dedication.text }`
      let inferred = _inferred(query)
      let { Books } = model.entities
      expect(inferred.elements).to.deep.equal({
        ID: Books.elements.ID,
        dedication: Books.elements.dedication, // path of length 1: always interpreted as column ref, never as alias
        title: Books.elements.title,
        dedication_text: Books.elements.dedication.elements.text,
      })
    })
    it('element has the same name as the query alias and is still addressable', () => {
      let query = CQL`SELECT from bookshop.Books as dedication { ID, dedication.dedication.text }`
      let inferred = _inferred(query)
      let { Books } = model.entities
      expect(inferred.elements).to.deep.equal({
        ID: Books.elements.ID,
        dedication_text: Books.elements.dedication.elements.text,
      })
    })
  })

  describe('$self', () => {
    // REVISIT: we don't need to handle annotations at runtime
    it('$self addresses an element of the select list', () => {
      let query = CQL`SELECT from bookshop.Books {
      $self.ID as BeforeItWasOverwritten,
      key 1 + 1 as ID @foo,
      $self.ID as AfterItWasOverwritten,
      ID as realID,
      ID as realIDWithAnno @foo,
      $self.realID as realIDOnlyAnno @foo,
      $self.realIDWithAnno as realIDBoo @boo,
      $self.realIDWithAnno as overwritesFoo @(foo: 'bar')
    }`

      // workaround: annotations are lost after parsing the CQL
      let {
        SELECT: { columns },
      } = query
      columns[1]['@foo'] = true
      columns[4]['@foo'] = true
      columns[5]['@foo'] = true
      columns[6]['@boo'] = true
      columns[7]['@foo'] = 'bar'

      let inferred = _inferred(query)
      let { Books } = model.entities
      expect(inferred.elements).to.deep.equal({
        ID: { key: true, '@foo': true },
        realID: Books.elements.ID,
        realIDWithAnno: { ...Books.elements.ID, '@foo': true },
        BeforeItWasOverwritten: { ...inferred.elements.ID, '@foo': true },
        AfterItWasOverwritten: { ...inferred.elements.ID, '@foo': true },
        realIDOnlyAnno: { ...inferred.elements.realID, '@foo': true },
        realIDBoo: { ...inferred.elements.realIDWithAnno, '@boo': true },
        overwritesFoo: { ...inferred.elements.realIDWithAnno, '@foo': 'bar' },
      })
    })
  })
  describe('multiple sources', () => {
    it('supports queries based on multiple sources without projections', () => {
      let query = CQL`SELECT from bookshop.Books, bookshop.Receipt`
      let inferred = _inferred(query)
      let { Books, Receipt } = model.entities
      expect(inferred).to.have.nested.property('sources.Books', Books)
      expect(inferred).to.have.nested.property('sources.Receipt', Receipt)
      // eslint-disable-next-line no-unused-vars
      const { image, ...BooksElementsWithoutBlob } = Books.elements
      expect(inferred.elements).to.deep.equal({ ...BooksElementsWithoutBlob, ...Receipt.elements }) // combined elements
    })

    it('supports queries based on multiple sources with a *', () => {
      let query = CQL`SELECT from bookshop.Books, bookshop.Receipt { * }`
      let inferred = _inferred(query)
      let { Books, Receipt } = model.entities
      expect(inferred).to.have.nested.property('sources.Books', Books)
      expect(inferred).to.have.nested.property('sources.Receipt', Receipt)
      // eslint-disable-next-line no-unused-vars
      const { image, ...BooksElementsWithoutBlob } = Books.elements
      expect(inferred.elements).to.deep.equal({ ...BooksElementsWithoutBlob, ...Receipt.elements }) // combined elements
    })
  })
  describe('scoped queries', () => {
    it('use table alias of scoped query', () => {
      let inferred = _inferred(CQL`SELECT from bookshop.Books:genre.foo {
      foo.ID as fooID
      }`)
      let { Books, Genres } = model.entities

      expect(inferred.target)
        .equals(Books.elements.genre._target.elements.foo._target)
        .equals(Genres.elements.foo._target)

      expect(inferred.elements).to.deep.equal({
        fooID: Genres.elements.ID,
      })
    })

    it('use table alias of scoped query (assoc defined via type reference)', () => {
      let inferred = _inferred(CQL`SELECT from bookshop.Books:coAuthor {
      coAuthor.name as name
    }`)
      let { Books, Authors } = model.entities

      expect(inferred.target).to.deep.equal(Books.elements.coAuthor._target).to.deep.equal(Authors)
      expect(inferred.elements).to.deep.equal({
        name: Authors.elements.name,
      })
    })
  })
  describe('subqueries', () => {
    it('supports expressions and subqueries in the select list', () => {
      let query = CQL`
    SELECT from bookshop.Books {
      1 + 1 as Two,
      (select from (select from bookshop.Authors) as A) as subquery
    }`
      let inferred = _inferred(query)

      let { Books } = model.entities
      expect(inferred).to.have.nested.property('sources.Books', Books)
      let expectedElements = {
        Two: {},
        subquery: {},
      }
      expect(inferred.elements).to.deep.equal(expectedElements)
    })
  })
  describe('expressions', () => {
    it('supports expressions and subqueries in the select list', () => {
      let query = CQL`
    SELECT from bookshop.Books {
      1 + 1 as Two,
      (select from (select from bookshop.Authors) as A) as subquery
    }`
      let inferred = _inferred(query)

      let { Books } = model.entities
      expect(inferred).to.have.nested.property('sources.Books', Books)
      let expectedElements = {
        Two: {},
        subquery: {},
      }
      expect(inferred.elements).to.deep.equal(expectedElements)
    })

    it('anonymous functions are inferred by their func property name', () => {
      let functionWithoutAlias = CQL`SELECT from bookshop.Books { sum(1 + 1), count(*) }`
      const inferred = _inferred(functionWithoutAlias)
      expect(inferred.elements).to.have.keys(['sum', 'count'])
    })

    it('infers functions results as query element', () => {
      let query = CQL`
    SELECT from bookshop.Books {
      func(stock*price) as net,
    }`
      let inferred = _inferred(query)

      let { Books } = model.entities
      expect(inferred).to.have.nested.property('sources.Books', Books)
      let expectedElements = {
        net: {},
      }
      expect(inferred.elements).to.deep.equal(expectedElements)
    })

    it('supports an expression with fields in the select list', () => {
      let query = CQL`SELECT from bookshop.Books { title + descr as noType }`
      let inferred = _inferred(query)

      let { Books } = model.entities
      expect(inferred).to.have.nested.property('sources.Books', Books)
      let expectedElements = {
        noType: {},
      }
      expect(inferred.elements).to.deep.equal(expectedElements)
    })
  })

  describe('casts', () => {
    it('simple values, cdl style cast', () => {
      let query = CQL(`SELECT from bookshop.Books {
      5 as price, 3.14 as pi,
      3.1415 as pid : cds.Decimal(5,4),
      'simple string' as string,
      'large string' as stringl : cds.LargeString,
      false as boolf,
      true as boolt,
      null as nullt,
      null as nullc : cds.String,
      '1970-01-01' as date : cds.Date,
      '00:00:00' as time : cds.Time,
      '1970-01-01 00:00:00' as datetime : cds.DateTime,
      '1970-01-01 00:00:00.000' as timestamp : cds.Timestamp,
    }`)
      let inferred = _inferred(query)
      let { Books } = model.entities
      expect(inferred).to.have.nested.property('sources.Books', Books)
      expect(inferred.elements).to.deep.equal({
        price: {
          type: 'cds.Integer',
        },
        pi: {
          type: 'cds.Decimal',
        },
        pid: {
          type: 'cds.Decimal',
          // REVISIT: currently CQL does not retain type arguments
          // precision: 5,
          // scale: 4
        },
        boolf: {
          type: 'cds.Boolean',
        },
        boolt: {
          type: 'cds.Boolean',
        },
        nullt: {},
        nullc: {
          type: 'cds.String',
        },
        date: {
          type: 'cds.Date',
        },
        time: {
          type: 'cds.Time',
        },
        datetime: {
          type: 'cds.DateTime',
        },
        timestamp: {
          type: 'cds.Timestamp',
        },
        string: {
          type: 'cds.String',
        },
        stringl: {
          type: 'cds.LargeString',
        },
      })
    })

    it('supports a cast expression in the select list', () => {
      let query = CQL`SELECT from bookshop.Books { cast(cast(ID as Integer) as String) as IDS, cast(ID as bookshop.DerivedFromDerivedString) as IDCustomType }`
      let inferred = _inferred(query)
      let { Books } = model.entities
      expect(inferred).to.have.nested.property('sources.Books', Books)
      let expectedElements = {
        IDS: {
          type: 'cds.String',
        },
        IDCustomType: {
          type: 'bookshop.DerivedFromDerivedString',
        },
      }
      expect(inferred.elements).to.deep.equal(expectedElements)
    })

    it('supports a cdl-style cast in the select list', () => {
      // Revisit: clarify what the cast should mean
      let query = CQL`
        SELECT from bookshop.Books {
          dedication.sub.foo: Integer,
          ID as IDS: String,
          ID as IDCustomType: bookshop.DerivedFromDerivedString
        }`
      let inferred = _inferred(query)
      let expectedElements = {
        dedication_sub_foo: {
          type: 'cds.Integer',
        },
        IDS: {
          type: 'cds.String',
        },
        IDCustomType: {
          type: 'bookshop.DerivedFromDerivedString',
        },
      }
      expect(inferred.elements).to.containSubset(expectedElements)
    })
  })

  describe('wildcards', () => {
    it('* in the column list', () => {
      let query = CQL`SELECT from bookshop.Books { * }`
      let inferred = _inferred(query)

      let { Books } = model.entities
      expect(inferred).to.have.nested.property('sources.Books', Books)
      // blobs are not part of the query elements
      // eslint-disable-next-line no-unused-vars
      const { image, ...BooksElementsWithoutBlob } = Books.elements
      expect(inferred.elements).to.deep.equal(BooksElementsWithoutBlob)
    })

    it('query without projections', () => {
      let query = CQL`SELECT from bookshop.Books`
      let inferred = _inferred(query)
      let { Books } = model.entities
      // blobs are not part of the query elements
      // eslint-disable-next-line no-unused-vars
      const { image, ...BooksElementsWithoutBlob } = Books.elements
      expect(inferred.elements).to.deep.equal(BooksElementsWithoutBlob)
    })

    it('respects "excluding" when inferring elements from a *', () => {
      let query = CQL`SELECT from bookshop.Bar { *, ID, note } excluding { ID, stock }`
      let inferred = _inferred(query)
      let { Bar } = model.entities
      const expectedElements = { ...Bar.elements }
      // excluding only relevant for wildcards, hence only "stock"
      // are not part of the inferred elements -> ID is explicitly selected
      delete expectedElements.stock // stock is part of excluding
      expect(inferred.elements).to.deep.equal(expectedElements)
    })

    it('excluding only acts on "*" - not on explicit select items', () => {
      let query = CQL`SELECT from bookshop.Bar { ID, note } excluding { ID }`
      let inferred = _inferred(query)
      let { Bar } = model.entities
      const expectedElements = { ID: Bar.elements.ID, note: Bar.elements.note }
      expect(inferred.elements).to.deep.equal(expectedElements)
    })

    // some more excluding tests

    it('replaces a select item coming from wildcard if it is overridden', () => {
      let query = CQL`SELECT from bookshop.Books { 5 * 5 as price, *, 1 + 1 as ID, author.name as author }` // TODO: take care of order
      let inferred = _inferred(query)
      let { Books } = model.entities
      expect(inferred).to.have.nested.property('sources.Books', Books)
      // eslint-disable-next-line no-unused-vars
      let { image, ...expectedElements } = Books.elements
      Object.assign(expectedElements, {
        ID: {},
        price: {},
        author: Books.elements.author._target.elements.name,
      })
      expect(inferred.elements).to.deep.equal(expectedElements)
      expect(inferred.elements).to.have.nested.property('author.name', 'author')
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
          $now: { type: 'cds.Timestamp' },
          $at: { type: 'cds.Timestamp' },
          $from: { type: 'cds.Timestamp' },
          $to: { type: 'cds.Timestamp' },
          $locale: { type: 'cds.String' },
          $tenant: { type: 'cds.String' },
        },
      }
      let query = CQL`SELECT from bookshop.Bar {
      $user,
      $user.id,
      $user.locale,
      $user.tenant,
      $user.unknown.foo.bar,

      $now,
      $at,
      $to,
      $from,
      $locale,
      $tenant
    }`
      let inferred = _inferred(query)
      const expectedElements = {
        $user: pseudos.elements.$user.elements.id,
        $user_id: pseudos.elements.$user.elements.id,
        $user_locale: pseudos.elements.$user.elements.locale,
        $user_tenant: pseudos.elements.$user.elements.tenant,
        $user_unknown_foo_bar: {},
        $now: pseudos.elements.$now,
        $at: pseudos.elements.$at,
        $to: pseudos.elements.$to,
        $from: pseudos.elements.$from,
        $locale: pseudos.elements.$locale,
        $tenant: pseudos.elements.$tenant,
      }
      expect(inferred.elements).to.deep.equal(expectedElements)
    })

    it('$variables in where do not matter for infer', () => {
      let query = CQL`SELECT from bookshop.Bar where createdAt < $now`
      // let query2 = CQL`SELECT from bookshop.Orders where buyer = $user`
      // let query3 = CQL`SELECT from bookshop.Orders where buyer = $user.id`

      let inferred = _inferred(query)
      let { Bar } = model.entities
      expect(inferred.elements).to.deep.equal(Bar.elements)
    })
  })

  describe('binding params', () => {
    it('put binding parameter into query elements as empty object', () => {
      const query = {
        SELECT: {
          columns: [{ ref: ['ID'] }, { ref: ['?'], param: true, as: 'discount' }],
          from: { ref: ['bookshop.Books'] },
          where: [{ ref: ['ID'] }, '=', { ref: ['?'], param: true }],
        },
      }
      const inferred = _inferred(query, model)
      expect(Object.keys(inferred.elements).length).to.eql(inferred.SELECT.columns.length)
      expect(inferred.elements['discount']).to.eql({})
    })
    it('respect cast type on binding parameter', () => {
      const query = {
        SELECT: {
          columns: [{ ref: ['ID'] }, { ref: ['?'], param: true, as: 'discount', cast: { type: 'cds.Integer' } }],
          from: { ref: ['bookshop.Books'] },
          where: [{ ref: ['ID'] }, '=', { ref: ['?'], param: true }],
        },
      }
      const inferred = _inferred(query, model)
      expect(Object.keys(inferred.elements).length).to.eql(inferred.SELECT.columns.length)
      expect(inferred.elements['discount']).to.eql({ type: 'cds.Integer' })
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
      expect(Object.keys(inferred.elements).length).to.eql(inferred.SELECT.columns.length)
      expect(inferred.elements['discount']).to.eql({ type: 'cds.Integer' })
    })
  })
})
