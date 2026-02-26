'use strict'

const cds = require('@sap/cds')

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
      expect(() =>
        _inferred(cds.ql`SELECT from bookshop.Books { ID, dedication[text='foo'].sub.foo }`, model),
      ).to.throw(/A filter can only be provided when navigating along associations/)
    })
    it('join relevant path is rejected (path expressions inside filter only enabled for exists subqueries)', () => {
      expect(() =>
        _inferred(
          cds.ql`SELECT from bookshop.Authors { ID, books[dedication.addressee.name = 'Hasso'].dedication.addressee.name as Hasso }`,
          model,
        ),
      ).to.throw('Only foreign keys of “addressee” can be accessed in infix filter')
    })
    it('filter must not be provided along a structure in from path expression', () => {
      expect(() => {
        _inferred(cds.ql`SELECT from bookshop.Books:dedication[sub.foo = 'bar'].addressee`, model)
      }).to.throw('A filter can only be provided when navigating along associations')
    })
    it('dangling filter must not be used on association in column', () => {
      expect(() => {
        _inferred(cds.ql`SELECT from bookshop.Books { author[ID=42] }`, model)
      }).to.throw('A filter can only be provided when navigating along associations')
    })
    it('dangling filter must not be used on association in where', () => {
      expect(() => {
        _inferred(cds.ql`SELECT from bookshop.Books { * } where author[id=42]`, model)
      }).to.throw('A filter can only be provided when navigating along associations')
    })
  })

  describe('reference not resolvable', () => {
    it("element can't be found", () => {
      let query = cds.ql`SELECT from bookshop.Books as Foo { boz }`
      expect(() => _inferred(query)).to.throw(/"boz" not found in the elements of "bookshop.Books"/) // revisit: or Foo?
    })

    it('deeply nested element is not found', () => {
      let query = cds.ql`SELECT from bookshop.Books as Foo { Foo.dedication.sub.boz }`
      expect(() => _inferred(query)).to.throw(/"boz" not found in "bookshop.Books:dedication.sub"/) // revisit: Foo:dedication.sub ?
    })

    it("element can't be found in elements of subquery", () => {
      let query = cds.ql`SELECT from (select from bookshop.Books { ID as FooID }) as Foo { ID }`
      expect(() => _inferred(query)).to.throw(/"ID" not found in the elements of "Foo"/)
    })
    it("reference in group by can't be found in alias of subquery", () => {
      let query = cds.ql`SELECT from (select from bookshop.Books { ID as FooID }) as Foo group by Foo.ID`
      expect(() => _inferred(query)).to.throw(/"ID" not found in "Foo"/)
    })

    it('intermediate step in path expression is not found', () => {
      let query = cds.ql`SELECT from bookshop.Books as Foo { Foo.notExisting.sub.boz }`
      expect(() => _inferred(query)).to.throw(/"notExisting" not found in "bookshop.Books"/) // or Foo:dedication.sub ?
    })

    it('table alias shadows element of query source', () => {
      // could be addressed via `dedication.dedication.text`
      let query = cds.ql`SELECT from bookshop.Books as dedication { dedication.text }`
      expect(() => _inferred(query)).to.throw(/"text" not found in "bookshop.Books"/)
    })

    it('first path step of from is not resolvable without absolute name', () => {
      let query = cds.ql`SELECT from Books`
      expect(() => _inferred(query)).to.throw(/"Books" not found in the definitions of your model/)
    })

    it('user defined table alias overwrites implicit table alias', () => {
      let query = cds.ql`SELECT from bookshop.Books as dedication { Books.dedication }`
      expect(() => _inferred(query)).to.throw(/"Books" not found in the elements of "bookshop.Books"/)
    })

    it('$self reference is not found in the queries elements', () => {
      let query = cds.ql`SELECT from bookshop.Books { ID, $self.boo }`
      expect(() => _inferred(query)).to.throw(/"boo" not found in the columns list of query/) // revisit: error message
    })

    it('filter path is not resolvable in column', () => {
      let query = cds.ql`SELECT from bookshop.Books { ID, dedication.addressee[title = 'Harry Potter'].ID }`
      expect(() => _inferred(query)).to.throw(/"title" not found in "addressee"/) // revisit: better error location "bookshop.Books:dedication.addressee"
    })

    it('filter path is not resolvable in where', () => {
      let query = cds.ql`SELECT from bookshop.Books where exists author[title = 'Harry Potter']`
      expect(() => _inferred(query)).to.throw(/"title" not found in "author"/) // revisit: better error location ""bookshop.Books:author"
    })

    it('exists subquery table alias not available in filter', () => {
      expect(() =>
        _inferred(cds.ql`SELECT from bookshop.Authors { ID } WHERE EXISTS books[books.title = 'ABAP Objects']`),
      ).to.throw(/"books" not found in "books"/)
    })

    it('outer query table alias not available in filter', () => {
      expect(() =>
        _inferred(cds.ql`SELECT from bookshop.Authors { ID } WHERE EXISTS books[Authors.name = 'Horst']`),
      ).to.throw(/"Authors" not found in "books"/)
    })

    it('$self reference is not found in the query elements -> infer hints alternatives', () => {
      let query = cds.ql`SELECT from bookshop.Books as Books { ID, $self.author }`
      expect(() => _inferred(query)).to.throw(
        /"author" not found in the columns list of query, did you mean "Books.author"?/, // revisit: error message
      )
    })

    it('$self reference is not found in the query elements with subquery -> infer hints alternatives', () => {
      let query = cds.ql`SELECT from (select from bookshop.Books) as Foo { $self.author }`
      // _inferred(query)
      // wording? select list not optimal, did you mean to refer to bookshop.Books?
      expect(() => _inferred(query)).to.throw(
        /"author" not found in the columns list of query, did you mean "Foo.author"?/, // revisit: error message
      )
    })

    it('lone $self ref is treated as regular element', () => {
      let query = cds.ql`SELECT from bookshop.Books { $self }`
      expect(() => _inferred(query)).to.throw(/"\$self" not found in the elements of "bookshop.Books"/)
    })

    it('lone query alias ref is treated as regular element', () => {
      let query = cds.ql`SELECT from bookshop.Books as Foo { Foo }`
      expect(() => _inferred(query)).to.throw(/"Foo" not found in the elements of "bookshop.Books"/) // or Foo?
    })

    it('scoped query does not end in queryable artifact', () => {
      let query = cds.ql`SELECT from bookshop.Books:name { * }` // name does not exist
      expect(() => _inferred(query)).to.throw(/No association “name” in entity “bookshop.Books”/)
      let fromEndsWithScalar = cds.ql`SELECT from bookshop.Books:title { * }`
      expect(() => _inferred(fromEndsWithScalar)).to.throw(/Query source must be a an entity or an association/)
    })

    // queries with multiple sources are not supported for cqn4sql transformation  (at least for now)
    // however, such queries can still be inferred
    it("element can't be found in one of multiple query sources", () => {
      let query = cds.ql`SELECT from bookshop.Books:author as Bar, bookshop.Books { doesNotExist }`
      expect(() => _inferred(query)).to.throw(
        /"doesNotExist" not found in the elements of "bookshop.Authors", "bookshop.Books"/,
      )
    })
  })

  describe('expressions', () => {
    it('expression needs alias', () => {
      let expressionWithoutAlias = cds.ql`SELECT from bookshop.Books as Foo { 1 + 1 }`
      let subqueryExpressionWithoutAlias = cds.ql`SELECT from bookshop.Books as Foo { (select from bookshop.Books) }`
      expect(() => _inferred(expressionWithoutAlias)).to.throw(/Expecting expression to have an alias name/)
      expect(() => _inferred(subqueryExpressionWithoutAlias)).to.throw(/Expecting expression to have an alias name/)
    })
    it('no cast on structure', () => {
      let castOnStruct = cds.ql`SELECT from bookshop.Books as Foo { dedication: cds.String }`
      let castFuncOnStruct = cds.ql`SELECT from bookshop.Books as Foo { cast(dedication as cds.Binary) as foo }`
      expect(() => _inferred(castOnStruct)).to.throw(/Structured elements can't be cast to a different type/)
      expect(() => _inferred(castFuncOnStruct)).to.throw(/Structured elements can't be cast to a different type/)
    })
  })

  describe('ambiguities', () => {
    // same name twice in result set -> error
    // SQL would allow that, but different databases may return different column names
    it('duplicate field name', () => {
      expect(() => _inferred(cds.ql`SELECT from bookshop.Books { ID, ID }`)).to.throw(
        /Duplicate definition of element “ID”/,
      )
    })
    it('duplicate definition of nested projection (expand)', () => {
      expect(() => _inferred(cds.ql`SELECT from bookshop.Books { author {name}, author {name} }`)).to.throw(
        /Duplicate definition of element “author”/,
      )
    })
    it('duplicate definition of nested projection (inline)', () => {
      expect(() => _inferred(cds.ql`SELECT from bookshop.Books { author.{name}, author.{name} }`)).to.throw(
        /Duplicate definition of element “author_name”/,
      )
    })

    it('anonymous functions are inferred by their func property name, ambiguities are rejected', () => {
      let ambiguousFunctions = cds.ql`SELECT from bookshop.Books { sum(1 + 1), sum(1 + 1) }`
      expect(() => _inferred(ambiguousFunctions)).to.throw(/Duplicate definition of element “sum”/)
    })

    it('multiple subqueries/xprs have same alias', () => {
      let ambiguousFunctions = cds.ql`SELECT from bookshop.Books { (select * from bookshop.Books) as foo, (1+1) as foo }`
      expect(() => _inferred(ambiguousFunctions)).to.throw(/Duplicate definition of element “foo”/)
    })

    it('multiple values have same alias', () => {
      let ambiguousFunctions = cds.ql`SELECT from bookshop.Books { 1 as foo, 2 as foo }`
      expect(() => _inferred(ambiguousFunctions)).to.throw(/Duplicate definition of element “foo”/)
    })

    it('value has same (implicit) alias as other column', () => {
      let ambiguousFunctions = cds.ql`SELECT from bookshop.Books { ID as ![false], false }`
      expect(() => _inferred(ambiguousFunctions)).to.throw(/Duplicate definition of element “false”/)
    })

    describe('with multiple query sources', () => {
      // queries with multiple sources are not supported for cqn4sql transformation  (at least for now)
      // however, such queries can still be inferred
      it('element reference is ambiguous', () => {
        let query = cds.ql`SELECT from bookshop.Books as Books, bookshop.Authors as Authors { ID }`
        expect(() => _inferred(query)).to.throw(/ambiguous reference to "ID", write "Books.ID", "Authors.ID" instead/)
      })

      it('table alias is ambiguous', () => {
        let query = cds.ql`SELECT from bookshop.Books as Books, bookshop.Books as Books { * }`
        expect(() => _inferred(query)).to.throw(/Duplicate alias "Books"/)
      })

      it('table alias via association is ambiguous', () => {
        let query = cds.ql`SELECT from bookshop.Books:author as author join bookshop.Books:author as author on 1 = 1 { * }`
        expect(() => _inferred(query)).to.throw(/Duplicate alias "author"/)
      })

      it('wildcard (no projection) is ambiguous', () => {
        let query = cds.ql`SELECT from bookshop.Books as Books, bookshop.Foo as Foo`
        expect(() => _inferred(query)).to.throw(/select "ID" explicitly with "Books.ID", "Foo.ID"/)
      })

      it('wildcard (*) is ambiguous', () => {
        let query = cds.ql`SELECT from bookshop.Books as Books, bookshop.Authors as Authors { * }`
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
        let query = cds.ql`SELECT from (select from bookshop.Books) as BooksSub, bookshop.Authors as Authors { * }`
        expect(() => _inferred(query)).to.throw(
          `Ambiguous wildcard elements:
       select "createdAt" explicitly with "BooksSub.createdAt", "Authors.createdAt"
       select "createdBy" explicitly with "BooksSub.createdBy", "Authors.createdBy"
       select "modifiedAt" explicitly with "BooksSub.modifiedAt", "Authors.modifiedAt"
       select "modifiedBy" explicitly with "BooksSub.modifiedBy", "Authors.modifiedBy"
       select "ID" explicitly with "BooksSub.ID", "Authors.ID"`,
        )
      })

      it('duplicated wildcard is not allowed', () => {
        let query = cds.ql`SELECT from bookshop.Books as Books { *, 1+1 as calc, * }`
        expect(() => _inferred(query)).to.throw(/Duplicate wildcard "\*" in column list/)
      })

      it('duplicated wildcard is not allowed in expand on assoc', () => {
        let query = cds.ql`SELECT from bookshop.Books as Books { *, author { *, 1+1 as calc, * } }`
        expect(() => _inferred(query)).to.throw(/Duplicate wildcard "\*" in expand of "author"/)
      })

      it('duplicated wildcard is not allowed in expand on structure', () => {
        let query = cds.ql`SELECT from bookshop.Books as Books { *, dedication { *, 1+1 as calc, * } }`
        expect(() => _inferred(query)).to.throw(/Duplicate wildcard "\*" in expand of "dedication"/)
      })

      it('duplicated wildcard is not allowed in inline on assoc', () => {
        let query = cds.ql`SELECT from bookshop.Books as Books { *, author.{ *, 1 as calc, * } }`
        expect(() => _inferred(query)).to.throw(/Duplicate wildcard "\*" in inline of "author"/)
      })

      it('duplicated wildcard is not allowed in inline on structure', () => {
        let query = cds.ql`SELECT from bookshop.Books as Books { *, dedication.{ *, 1 as calc, * } }`
        expect(() => _inferred(query)).to.throw(/Duplicate wildcard "\*" in inline of "dedication"/)
      })
    })
  })

  describe('path traversals via $self are rejected', () => {
    it('simple field access', () => {
      const errorMessage =
        'Paths starting with “$self” must not contain steps of type “cds.Association”: ref: [ $self, author, name ]'
      expect(() =>
        _inferred(
          cds.ql`SELECT from bookshop.Books{
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
          cds.ql`SELECT from bookshop.Books{
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
          cds.ql`SELECT from bookshop.Books{
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
          cds.ql`SELECT from bookshop.Books{
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
          cds.ql`SELECT from bookshop.Books{
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
          cds.ql`SELECT from bookshop.Books{
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
          cds.ql`SELECT from bookshop.Books{
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
          cds.ql`SELECT from bookshop.Books{
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
          cds.ql`SELECT from bookshop.Books{
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
      expect(() => _inferred(cds.ql`SELECT from bookshop.Books union all select from bookshop.Authors`)).to.throw(
        /”UNION” based queries are not supported/,
      )
    })

    it('selecting from structures is not supported', () => {
      expect(() => _inferred(cds.ql`SELECT from bookshop.Books:dedication.addressee.address`, model)).to.throw(
        /Query source must be a an entity or an association/,
      )
    })

    it('subquery cant see the scope of enclosing query', () => {
      // infer does not infer deeply -> cqn4sql calls itself recursively
      // in case of nested subqueries
      expect(() =>
        cqn4sql(
          cds.ql`SELECT from bookshop.Books { ID, (SELECT from bookshop.Authors { ID } where name = title) as foo }`,
          model,
        ),
      ).to.throw(/"title" not found in the elements of "bookshop.Authors"/)
    })

    it('expand on `.items` not possible', () => {
      expect(() => _inferred(cds.ql`SELECT from bookshop.SoccerPlayers { name, emails { address } }`, model)).to.throw(
        'Unexpected “expand” on “emails”; can only be used after a reference to a structure, association or table alias',
      )
    })
    it('expand on scalar not possible', () => {
      expect(() => _inferred(cds.ql`SELECT from bookshop.SoccerPlayers { name { address } }`, model)).to.throw(
        'Unexpected “expand” on “name”; can only be used after a reference to a structure, association or table alias',
      )
    })

    it('inline on `.items` not possible', () => {
      expect(() => _inferred(cds.ql`SELECT from bookshop.SoccerPlayers { name, emails.{ address } }`, model)).to.throw(
        'Unexpected “inline” on “emails”; can only be used after a reference to a structure, association or table alias',
      )
    })
    it('inline on scalar not possible', () => {
      expect(() => _inferred(cds.ql`SELECT from bookshop.SoccerPlayers { name.{ address } }`, model)).to.throw(
        'Unexpected “inline” on “name”; can only be used after a reference to a structure, association or table alias',
      )
    })
  })

  describe('infix filters', () => {
    it('rejects non fk traversal in infix filter in from', () => {
      expect(() => _inferred(cds.ql`SELECT from bookshop.Books[author.name = 'Kurt']`, model)).to.throw(
        /Only foreign keys of “author” can be accessed in infix filter, but found “name”/,
      )
    })
    it('does not reject non fk traversal in infix filter in where exists', () => {
      let query = cds.ql`SELECT from bookshop.Books where exists author.books[author.name = 'John Doe']`
      expect(() => _inferred(query)).to.not.throw(
        /Only foreign keys of “author” can be accessed in infix filter, but found “name”/,
      )
    })
    it('rejects non fk traversal in infix filter in where', () => {
      let query = cds.ql`SELECT from bookshop.Books where author.books[author.name = 'John Doe'].title = 'foo'`
      expect(() => _inferred(query)).to.throw(
        /Only foreign keys of “author” can be accessed in infix filter, but found “name”/,
      )
    })
    it('does not reject unmanaged traversal in infix filter in where exists', () => {
      let query = cds.ql`SELECT from bookshop.Books where exists author.books[coAuthorUnmanaged.name = 'John Doe']`
      expect(() => _inferred(query)).to.not.throw(
        /Unexpected unmanaged association “coAuthorUnmanaged” in filter expression of “books”/,
      )
    })

    it('rejects non fk traversal in infix filter in column', () => {
      expect(() =>
        _inferred(
          cds.ql`SELECT from bookshop.Authors {
        books[author.name = 'Kurt'].ID as kurtsBooks
      }`,
          model,
        ),
      ).to.throw(/Only foreign keys of “author” can be accessed in infix filter/)
    })
  })

  describe('order by', () => {
    it('reject join relevant path via queries own columns', () => {
      let query = cds.ql`SELECT from bookshop.Books as Books  {
        ID,
        author,
        coAuthor as co
      }
      order by
        Books.author,
        co.name`
      expect(() => {
        cqn4sql(query, model)
      }).to.throw(/Can follow managed association “co” only to the keys of its target, not to “name”/)
    })
  })
})
