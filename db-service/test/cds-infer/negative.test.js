'use strict'

const cds = require('@sap/cds/lib')

const { expect } = cds.test.in(__dirname + '/../bookshop') // IMPORTANT: that has to go before the requires below to avoid loading cds.env before cds.test()
const cqn4sql = require('../../lib/cqn4sql')
const inferred = require('../../lib/infer')
function _inferred(q, m = cds.model) {
  return inferred(q, m)
}

describe('negative', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  describe('filters', () => {
    it('filter must not be provided along a structure in a column', () => {
      expect(() => _inferred(CQL`SELECT from bookshop.Books { ID, dedication[text='foo'].sub.foo }`, model)).to.throw(
        /A filter can only be provided when navigating along associations/,
      )
    })
    it('filter must not be provided along a structure in from path expression', () => {
      expect(() => {
        _inferred(CQL`SELECT from bookshop.Books:dedication[sub.foo = 'bar'].addressee`, model)
      }).to.throw('A filter can only be provided when navigating along associations')
    })
    it('dangling filter must not be used on association in column', () => {
      expect(() => {
        _inferred(CQL`SELECT from bookshop.Books { author[ID=42] }`, model)
      }).to.throw('A filter can only be provided when navigating along associations')
    })
    it('dangling filter must not be used on association in where', () => {
      expect(() => {
        _inferred(CQL`SELECT from bookshop.Books { * } where author[id=42]`, model)
      }).to.throw('A filter can only be provided when navigating along associations')
    })
  })

  describe('reference not resolvable', () => {
    it("element can't be found", () => {
      let query = CQL`SELECT from bookshop.Books as Foo { boz }`
      expect(() => _inferred(query)).to.throw(/"boz" not found in the elements of "bookshop.Books"/) // revisit: or Foo?
    })

    it('deeply nested element is not found', () => {
      let query = CQL`SELECT from bookshop.Books as Foo { Foo.dedication.sub.boz }`
      expect(() => _inferred(query)).to.throw(/"boz" not found in "bookshop.Books:dedication.sub"/) // revisit: Foo:dedication.sub ?
    })

    it("element can't be found in elements of subquery", () => {
      let query = CQL`SELECT from (select from bookshop.Books { ID as FooID }) as Foo { ID }`
      expect(() => _inferred(query)).to.throw(/"ID" not found in the elements of "Foo"/)
    })

    it('intermediate step in path expression is not found', () => {
      let query = CQL`SELECT from bookshop.Books as Foo { Foo.notExisting.sub.boz }`
      expect(() => _inferred(query)).to.throw(/"notExisting" not found in "bookshop.Books"/) // or Foo:dedication.sub ?
    })

    it('table alias shadows element of query source', () => {
      // could be addressed via `dedication.dedication.text`
      let query = CQL`SELECT from bookshop.Books as dedication { dedication.text }`
      expect(() => _inferred(query)).to.throw(/"text" not found in "bookshop.Books"/)
    })

    it('first path step of from is not resolvable without absolute name', () => {
      let query = CQL`SELECT from Books`
      expect(() => _inferred(query)).to.throw(/"Books" not found in the definitions of your model/)
    })

    it('user defined table alias overwrites implicit table alias', () => {
      let query = CQL`SELECT from bookshop.Books as dedication { Books.dedication }`
      expect(() => _inferred(query)).to.throw(/"Books" not found in the elements of "bookshop.Books"/)
    })

    it('$self reference is not found in the queries elements', () => {
      let query = CQL`SELECT from bookshop.Books { ID, $self.boo }`
      expect(() => _inferred(query)).to.throw(/"boo" not found in the columns list of query/) // revisit: error message
    })

    it('filter path is not resolvable in column', () => {
      let query = CQL`SELECT from bookshop.Books { ID, dedication.addressee[title = 'Harry Potter'].ID }`
      expect(() => _inferred(query)).to.throw(/"title" not found in "addressee"/) // revisit: better error location "bookshop.Books:dedication.addressee"
    })

    it('filter path is not resolvable in where', () => {
      let query = CQL`SELECT from bookshop.Books where exists author[title = 'Harry Potter']`
      expect(() => _inferred(query)).to.throw(/"title" not found in "author"/) // revisit: better error location ""bookshop.Books:author"
    })

    it('$self reference is not found in the query elements -> infer hints alternatives', () => {
      let query = CQL`SELECT from bookshop.Books { ID, $self.author }`
      expect(() => _inferred(query)).to.throw(
        /"author" not found in the columns list of query, did you mean "Books.author"?/, // revisit: error message
      )
    })

    it('$self reference is not found in the query elements with subquery -> infer hints alternatives', () => {
      let query = CQL`SELECT from (select from bookshop.Books) as Foo { $self.author }`
      // _inferred(query)
      // wording? select list not optimal, did you mean to refer to bookshop.Books?
      expect(() => _inferred(query)).to.throw(
        /"author" not found in the columns list of query, did you mean "Foo.author"?/, // revisit: error message
      )
    })

    it('lone $self ref is treated as regular element', () => {
      let query = CQL`SELECT from bookshop.Books { $self }`
      expect(() => _inferred(query)).to.throw(/"\$self" not found in the elements of "bookshop.Books"/)
    })

    it('lone query alias ref is treated as regular element', () => {
      let query = CQL`SELECT from bookshop.Books as Foo { Foo }`
      expect(() => _inferred(query)).to.throw(/"Foo" not found in the elements of "bookshop.Books"/) // or Foo?
    })

    it('scoped query does not end in queryable artifact', () => {
      let query = CQL`SELECT from bookshop.Books:name { * }` // name does not exist
      expect(() => _inferred(query)).to.throw(/No association “name” in entity “bookshop.Books”/)
      let fromEndsWithScalar = CQL`SELECT from bookshop.Books:title { * }`
      expect(() => _inferred(fromEndsWithScalar)).to.throw(/Query source must be a an entity or an association/)
    })

    // queries with multiple sources are not supported for cqn4sql transformation  (at least for now)
    // however, such queries can still be inferred
    it("element can't be found in one of multiple query sources", () => {
      let query = CQL`SELECT from bookshop.Books:author as Bar, bookshop.Books { doesNotExist }`
      expect(() => _inferred(query)).to.throw(
        /"doesNotExist" not found in the elements of "bookshop.Authors", "bookshop.Books"/,
      )
    })
  })

  describe('expressions', () => {
    it('expression needs alias', () => {
      let expressionWithoutAlias = CQL`SELECT from bookshop.Books as Foo { 1 + 1 }`
      let subqueryExpressionWithoutAlias = CQL`SELECT from bookshop.Books as Foo { (select from bookshop.Books) }`
      expect(() => _inferred(expressionWithoutAlias)).to.throw(/Expecting expression to have an alias name/)
      expect(() => _inferred(subqueryExpressionWithoutAlias)).to.throw(/Expecting expression to have an alias name/)
    })
    it('no cast on structure', () => {
      let castOnStruct = CQL`SELECT from bookshop.Books as Foo { dedication: cds.String }`
      let castFuncOnStruct = CQL`SELECT from bookshop.Books as Foo { cast(dedication as cds.Binary) as foo }`
      expect(() => _inferred(castOnStruct)).to.throw(/Structured elements can't be cast to a different type/)
      expect(() => _inferred(castFuncOnStruct)).to.throw(/Structured elements can't be cast to a different type/)
    })
  })

  describe('ambiguities', () => {
    // same name twice in result set -> error
    // SQL would allow that, but different databases may return different column names
    it('duplicate field name', () => {
      expect(() => _inferred(CQL`SELECT from bookshop.Books { ID, ID }`)).to.throw(
        /Duplicate definition of element “ID”/,
      )
    })

    it('anonymous functions are inferred by their func property name, ambiguities are rejected', () => {
      let ambiguousFunctions = CQL`SELECT from bookshop.Books { sum(1 + 1), sum(1 + 1) }`
      expect(() => _inferred(ambiguousFunctions)).to.throw(/Duplicate definition of element “sum”/)
    })

    it('multiple subqueries/xprs have same alias', () => {
      let ambiguousFunctions = CQL`SELECT from bookshop.Books { (select * from bookshop.Books) as foo, (1+1) as foo }`
      expect(() => _inferred(ambiguousFunctions)).to.throw(/Duplicate definition of element “foo”/)
    })

    it('multiple values have same alias', () => {
      let ambiguousFunctions = CQL`SELECT from bookshop.Books { 1 as foo, 2 as foo }`
      expect(() => _inferred(ambiguousFunctions)).to.throw(/Duplicate definition of element “foo”/)
    })

    it('value has same (implicit) alias as other column', () => {
      let ambiguousFunctions = CQL`SELECT from bookshop.Books { ID as ![false], false }`
      expect(() => _inferred(ambiguousFunctions)).to.throw(/Duplicate definition of element “false”/)
    })

    describe('with multiple query sources', () => {
      // queries with multiple sources are not supported for cqn4sql transformation  (at least for now)
      // however, such queries can still be inferred
      it('element reference is ambiguous', () => {
        let query = CQL`SELECT from bookshop.Books, bookshop.Authors { ID }`
        expect(() => _inferred(query)).to.throw(/ambiguous reference to "ID", write "Books.ID", "Authors.ID" instead/)
      })

      it('table alias is ambiguous', () => {
        let query = CQL`SELECT from bookshop.Books, bookshop.Books { * }`
        expect(() => _inferred(query)).to.throw(/Duplicate alias "Books"/)
      })

      it('table alias via association is ambiguous', () => {
        let query = CQL`SELECT from bookshop.Books:author join bookshop.Books:author on 1 = 1 { * }`
        expect(() => _inferred(query)).to.throw(/Duplicate alias "author"/)
      })

      it('wildcard (no projection) is ambiguous', () => {
        let query = CQL`SELECT from bookshop.Books, bookshop.Foo`
        expect(() => _inferred(query)).to.throw(/select "ID" explicitly with "Books.ID", "Foo.ID"/)
      })

      it('wildcard (*) is ambiguous', () => {
        let query = CQL`SELECT from bookshop.Books, bookshop.Authors { * }`
        expect(() => _inferred(query)).to.throw(
          `Ambiguous wildcard elements:
       select "createdAt" explicitly with "Books.createdAt", "Authors.createdAt"
       select "createdBy" explicitly with "Books.createdBy", "Authors.createdBy"
       select "modifiedAt" explicitly with "Books.modifiedAt", "Authors.modifiedAt"
       select "modifiedBy" explicitly with "Books.modifiedBy", "Authors.modifiedBy"
       select "ID" explicitly with "Books.ID", "Authors.ID"`,
        )
      })

      it('wildcard (*) is ambiguous with subqueries', () => {
        let query = CQL`SELECT from (select from bookshop.Books) as BooksSub, bookshop.Authors { * }`
        expect(() => _inferred(query)).to.throw(
          `Ambiguous wildcard elements:
       select "createdAt" explicitly with "BooksSub.createdAt", "Authors.createdAt"
       select "createdBy" explicitly with "BooksSub.createdBy", "Authors.createdBy"
       select "modifiedAt" explicitly with "BooksSub.modifiedAt", "Authors.modifiedAt"
       select "modifiedBy" explicitly with "BooksSub.modifiedBy", "Authors.modifiedBy"
       select "ID" explicitly with "BooksSub.ID", "Authors.ID"`,
        )
      })
    })
  })

  describe('path traversals via $self are rejected', () => {
    it('simple field access', () => {
      const errorMessage =
        'Paths starting with “$self” must not contain steps of type “cds.Association”: ref: [ $self, author, name ]'
      expect(() =>
        _inferred(
          CQL`SELECT from bookshop.Books{
        author,
        $self.author.name
      }`,
          model,
        ),
      ).to.throw(errorMessage)
    })
    it('in order by', () => {
      const errorMessage =
        'Paths starting with “$self” must not contain steps of type “cds.Association”: ref: [ $self, author, name ]'
      expect(() =>
        _inferred(
          CQL`SELECT from bookshop.Books{
        author
      } order by $self.author.name`,
          model,
        ),
      ).to.throw(errorMessage)
    })
    it('in group by', () => {
      const errorMessage =
        'Paths starting with “$self” must not contain steps of type “cds.Association”: ref: [ $self, author, name ]'
      expect(() =>
        _inferred(
          CQL`SELECT from bookshop.Books{
        author
      } group by $self.author.name`,
          model,
        ),
      ).to.throw(errorMessage)
    })
    it('in where', () => {
      const errorMessage =
        'Paths starting with “$self” must not contain steps of type “cds.Association”: ref: [ $self, author, name ]'
      expect(() =>
        _inferred(
          CQL`SELECT from bookshop.Books{
        author
      } where $self.author.name = 'King'`,
          model,
        ),
      ).to.throw(errorMessage)
    })
    it('in xpr', () => {
      const errorMessage =
        'Paths starting with “$self” must not contain steps of type “cds.Association”: ref: [ $self, author, name ]'
      expect(() =>
        _inferred(
          CQL`SELECT from bookshop.Books{
        author,
        'bar' + $self.author.name as barAuthor
      }`,
          model,
        ),
      ).to.throw(errorMessage)
    })
    it('deep field access', () => {
      const errorMessage =
        'Paths starting with “$self” must not contain steps of type “cds.Association”: ref: [ $self, dedication, addressee, ID ]'
      expect(() =>
        _inferred(
          CQL`SELECT from bookshop.Books{
        dedication,
        $self.dedication.addressee.ID
      }`,
          model,
        ),
      ).to.throw(errorMessage)
    })
    it('with infix filter', () => {
      const errorMessage = `Paths starting with “$self” must not contain steps of type “cds.Association”: ref: [ $self, author, ID ]`
      expect(() =>
        cqn4sql(
          CQL`SELECT from bookshop.Books{
        author,
        $self.author[ID = 42].ID as a
      }`,
          model,
        ),
      ).to.throw(errorMessage)
    })
    it('with inline syntax', () => {
      const errorMessage =
        'Paths starting with “$self” must not contain steps of type “cds.Association”: ref: [ $self, author ]'
      expect(() =>
        cqn4sql(
          CQL`SELECT from bookshop.Books{
        author,
        $self.author.{name}
      }`,
          model,
        ),
      ).to.throw(errorMessage)
    })
    it('with expand syntax', () => {
      const errorMessage =
        'Paths starting with “$self” must not contain steps of type “cds.Association”: ref: [ $self, author ]'
      expect(() =>
        cqn4sql(
          CQL`SELECT from bookshop.Books{
        author,
        $self.author {name}
      }`,
          model,
        ),
      ).to.throw(errorMessage)
    })
  })

  describe('restrictions', () => {
    it('UNION queries are not supported', () => {
      expect(() => _inferred(CQL`SELECT from bookshop.Books union all select from bookshop.Authors`)).to.throw(
        /”UNION” based queries are not supported/,
      )
    })

    it('selecting from structures is not supported', () => {
      expect(() => _inferred(CQL`SELECT from bookshop.Books:dedication.addressee.address`, model)).to.throw(
        /Query source must be a an entity or an association/,
      )
    })

    it('subquery cant see the scope of enclosing query', () => {
      // infer does not infer deeply -> cqn4sql calls itself recursively
      // in case of nested subqueries
      expect(() =>
        cqn4sql(
          CQL`SELECT from bookshop.Books { ID, (SELECT from bookshop.Authors { ID } where name = title) as foo }`,
          model,
        ),
      ).to.throw(/"title" not found in the elements of "bookshop.Authors"/)
    })
  })

  describe('infix filters', () => {
    it('rejects non fk traversal in infix filter in from', () => {
      expect(() => _inferred(CQL`SELECT from bookshop.Books[author.name = 'Kurt']`, model)).to.throw(
        /Only foreign keys of "author" can be accessed in infix filter/,
      )
    })
    it('rejects non fk traversal in infix filter in column', () => {
      expect(() =>
        _inferred(
          CQL`SELECT from bookshop.Authors {
        books[author.name = 'Kurt'].ID as kurtsBooks
      }`,
          model,
        ),
      ).to.throw(/Only foreign keys of "author" can be accessed in infix filter/)
    })
  })
})
