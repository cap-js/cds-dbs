'use strict'

const cds = require('@sap/cds/lib')
const { expect } = cds.test
const inferred = require('../../lib/infer')
function _inferred(q, m = cds.model) {
  return inferred(q, m)
}

describe('nested projections', () => {
  describe('expand', () => {
    let model
    beforeAll(async () => {
      model = cds.model = await await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
    })

    describe('structs', () => {
      it('simple element access', () => {
        let query = CQL`SELECT from bookshop.Books { ID, dedication { text } }`
        let inferred = _inferred(query)
        let { Books } = model.entities
        expect(inferred.elements).to.deep.equal({
          ID: Books.elements.ID,
          dedication: {
            elements: {
              text: Books.elements.dedication.elements.text, // only text!
            },
          },
        })
      })
      it('wildcard access in structs', () => {
        let query = CQL`SELECT from bookshop.Books { ID, dedication { * } }`
        let inferred = _inferred(query)
        let { Books } = model.entities
        expect(inferred.elements).to.deep.equal({
          ID: Books.elements.ID,
          dedication: {
            elements: Books.elements.dedication.elements,
          },
        })
      })
      it('respect alias of element in expand, combined with wildcard', () => {
        let query = CQL`SELECT from bookshop.Books { ID, dedication { dedication as foo, * } }`
        let inferred = _inferred(query)
        let { Books } = model.entities
        expect(inferred.elements).to.deep.equal({
          ID: Books.elements.ID,
          dedication: {
            elements: {
              foo: Books.elements.dedication.elements.dedication,
              ...Books.elements.dedication.elements,
            },
          },
        })
      })

      it('explicit column and wildcard do not clash - explicit first', () => {
        let query = CQL`SELECT from bookshop.Books { ID, dedication { dedication, * } }`
        let inferred = _inferred(query)
        let { Books } = model.entities
        expect(inferred.elements).to.deep.equal({
          ID: Books.elements.ID,
          dedication: {
            elements: {
              dedication: Books.elements.dedication.elements.dedication,
              addressee: Books.elements.dedication.elements.addressee,
              sub: Books.elements.dedication.elements.sub,
              text: Books.elements.dedication.elements.text,
            },
          },
        })
      })

      it('wildcard first, explicit follows with alias', () => {
        let query = CQL`SELECT from bookshop.Books { ID, dedication { *, dedication as foo } }`
        let inferred = _inferred(query)
        let { Books } = model.entities
        expect(inferred.elements).to.deep.equal({
          ID: Books.elements.ID,
          dedication: {
            elements: {
              ...Books.elements.dedication.elements,
              foo: Books.elements.dedication.elements.dedication,
            },
          },
        })
      })
    })

    describe('associations', () => {
      it('expand assocs via *', () => {
        let query = CQL`SELECT from bookshop.Books { ID, author { * } }`
        let inferred = _inferred(query)
        let { Books, Authors } = model.entities
        expect(inferred.elements).to.deep.equal({
          ID: Books.elements.ID,
          author: {
            elements: Authors.elements,
          },
        })
      })
      it('supports nested projections for assocs with a * (2)', () => {
        let query = CQL`SELECT from bookshop.Books { ID, author { ID as baz, * } }`
        let inferred = _inferred(query)
        let { Books, Authors } = model.entities
        expect(inferred.elements).to.deep.equal({
          ID: Books.elements.ID,
          author: {
            elements: { baz: Authors.elements.ID, ...Authors.elements },
          },
        })
      })
      it('supports nested projections for assocs with a * and respects column alias', () => {
        let query = CQL`SELECT from bookshop.Books { ID, author as BUBU { ID as baz, * } }`
        let inferred = _inferred(query)
        let { Books, Authors } = model.entities
        expect(inferred.elements).to.deep.equal({
          ID: Books.elements.ID,
          BUBU: {
            elements: { baz: Authors.elements.ID, ...Authors.elements },
          },
        })
      })
      it('deeply nested ', () => {
        let query = CQL`SELECT from bookshop.Authors { books { author { name } } }`
        let inferred = _inferred(query)
        let { Authors } = model.entities
        expect(inferred.elements).to.deep.equal({
          books: {
            items: {
              elements: {
                author: {
                  elements: {
                    name: Authors.elements.books._target.elements.author._target.elements.name,
                  },
                },
              },
            },
          },
        })
      })
      it('to many', () => {
        let query = CQL`SELECT from bookshop.Authors { books { title } }`
        let inferred = _inferred(query)
        let { Authors } = model.entities
        expect(inferred.elements).to.deep.equal({
          books: {
            items: {
              elements: {
                title: Authors.elements.books._target.elements.title,
              },
            },
          },
        })
      })
    })

    describe('anonymous', () => {
      it('scalar elements', () => {
        const q = CQL`SELECT from bookshop.Books {
          ID,
          {
            title,
            descr,
            author. { name }
          } as bookInfos
        }`
        let { Books } = model.entities
        const inferred = _inferred(q)
        expect(inferred.elements)
          .to.have.property('bookInfos')
          .that.eql({
            elements: {
              title: Books.elements.title,
              descr: Books.elements.descr,
              author_name: Books.elements.author._target.elements.name,
            },
          })
      })
      it('wildcard expand with explicit table alias', () => {
        const q = CQL`SELECT from bookshop.Books {
          Books { *, 'overwrite ID' as ID }
        }`
        let { Books } = model.entities
        const inferred = _inferred(q)
        expect(inferred.elements)
          .to.have.property('Books')
          .that.has.property('elements')
          .that.eql({
            ...Books.elements, // everything from books
            ID: { val: 'overwrite ID', as: 'ID' } // except ID is overwritten
          })
      })
      it('wildcard expand without explicit table alias', () => {
        const q = CQL`SELECT from bookshop.Books {
          { *, 'overwrite ID' as ID } as FOO
        }`
        let { Books } = model.entities
        const inferred = _inferred(q)
        expect(inferred.elements)
          .to.have.property('FOO')
          .that.has.property('elements')
          .that.eql({
            ...Books.elements, // everything from books
            ID: { val: 'overwrite ID', as: 'ID' } // except ID is overwritten
          })
      })
    })
  })

  describe('inline', () => {
    let model
    beforeAll(async () => {
      model = cds.model = await await cds.load(__dirname + '/model/nestedProjections').then(cds.linked)
    })

    it('prefix notation equivalent to structured access', () => {
      let queryInlineNotation = CQL`select from Employee {
        office.{
          floor,
          room
        }
      }`
      let queryStructuredAccess = CQL`select from Employee {
        office.floor,
        office.room
      }`
      let inferredInline = _inferred(queryInlineNotation)
      let inferredAbsolute = _inferred(queryStructuredAccess)
      let { Employee } = model.entities
      expect(inferredInline.elements).to.deep.equal(inferredAbsolute.elements).to.deep.equal({
        office_floor: Employee.elements.office.elements.floor,
        office_room: Employee.elements.office.elements.room,
      })
    })
    it('mixed with expand', () => {
      let queryInlineNotation = CQL`select from Employee {
            office {
              floor,
              address.{
                city,
                street
              }
            }
      }`
      let variantWithoutInline = CQL`select from Employee {
        office {
          floor,
          address.city,
          address.street
        }
      }`
      let inferredInline = _inferred(queryInlineNotation)
      let inferredAbsolute = _inferred(variantWithoutInline)
      let { Employee } = model.entities
      expect(inferredInline.elements)
        .to.deep.equal(inferredAbsolute.elements)
        .to.deep.equal({
          office: {
            elements: {
              floor: Employee.elements.office.elements.floor,
              address_city: Employee.elements.office.elements.address.elements.city,
              address_street: Employee.elements.office.elements.address.elements.street,
            },
          },
        })
    })
    it('deep inline', () => {
      let queryInlineNotation = CQL`select from Employee {
        office.{
          floor,
          address.{
            city,
            street,
            country.{code}
          }
        }
      }`
      let variantWithoutInline = CQL`select from Employee {
        office.floor,
        office.address.city,
        office.address.street,
        office.address.country.code
      }`
      let inferredInline = _inferred(queryInlineNotation)
      let inferredAbsolute = _inferred(variantWithoutInline)
      let { Employee } = model.entities
      expect(inferredInline.elements).to.deep.equal(inferredAbsolute.elements).to.deep.equal({
        office_floor: Employee.elements.office.elements.floor,
        office_address_city: Employee.elements.office.elements.address.elements.city,
        office_address_street: Employee.elements.office.elements.address.elements.street,
        office_address_country_code: Employee.elements.office.elements.address.elements.country._target.elements.code,
      })
    })
    it('deep expand in inline', () => {
      // revisit: naming
      let queryInlineNotation = CQL`select from Employee {
        office.{
          floor,
          address {
            city,
            street
          }
        }
      }`
      let variantWithoutInline = CQL`select from Employee {
        office.floor,
        office.address {
            city,
            street
        }
      }`
      let inferredInline = _inferred(queryInlineNotation)
      let inferredStruct = _inferred(variantWithoutInline)
      let { Employee } = model.entities
      expect(inferredInline.elements)
        .to.deep.equal(inferredStruct.elements)
        .to.deep.equal({
          office_floor: Employee.elements.office.elements.floor,
          office_address: {
            elements: {
              city: Employee.elements.office.elements.address.elements.city,
              street: Employee.elements.office.elements.address.elements.street,
            },
          },
        })
    })
    it('wildcard inline toplevel', () => {
      let queryInlineNotation = CQL`select from EmployeeNoUnmanaged {
        office.{ * }
      }`
      let inlineExplicit = CQL`select from EmployeeNoUnmanaged {
        office.{
          floor,
          room,
          building,
          address,
          furniture
        }
      }`
      let absolutePaths = CQL`select from EmployeeNoUnmanaged {
        office.floor,
        office.room,
        office.building,
        office.address,
        office.furniture
      }`
      let inferredInlineWildcard = _inferred(queryInlineNotation)
      let inferredInlineExplicit = _inferred(inlineExplicit)
      let inferredAbsolute = _inferred(absolutePaths)
      let { EmployeeNoUnmanaged } = model.entities
      expect(inferredInlineWildcard.elements)
        .to.deep.equal(inferredInlineExplicit.elements)
        .to.deep.equal(inferredAbsolute.elements)
        .to.deep.equal({
          office_floor: EmployeeNoUnmanaged.elements.office.elements.floor,
          office_room: EmployeeNoUnmanaged.elements.office.elements.room,
          office_building: EmployeeNoUnmanaged.elements.office.elements.building,
          office_address: {
            elements: EmployeeNoUnmanaged.elements.office.elements.address.elements,
          },
          office_furniture: {
            elements: EmployeeNoUnmanaged.elements.office.elements.furniture.elements,
          },
        })
    })
    it('wildcard inline deep w/o brackets', () => {
      let queryInlineNotation = CQL`select from EmployeeNoUnmanaged {
        office.{ address.* }
      }`
      let absolutePaths = CQL`select from EmployeeNoUnmanaged {
        office.address.city,
        office.address.street,
        office.address.country,
      }`
      let inferredInline = _inferred(queryInlineNotation)
      let inferredAbsolute = _inferred(absolutePaths)
      let { EmployeeNoUnmanaged } = model.entities
      expect(inferredInline.elements).to.deep.equal(inferredAbsolute.elements).to.deep.equal({
        office_address_city: EmployeeNoUnmanaged.elements.office.elements.address.elements.city,
        office_address_street: EmployeeNoUnmanaged.elements.office.elements.address.elements.street,
        office_address_country: EmployeeNoUnmanaged.elements.office.elements.address.elements.country,
      })
    })
    it('smart wildcard - column overwrite after *', () => {
      // office.address.city replaces office.floor
      let queryInlineNotation = CQL`select from EmployeeNoUnmanaged {
        office.{ *, address.city as floor }
      }`
      let absolutePaths = CQL`select from EmployeeNoUnmanaged {
        office.address.city as office_floor,
        office.room,
        office.building,
        office.address,
        office.furniture
      }`
      let inferredInline = _inferred(queryInlineNotation)
      let inferredAbsolute = _inferred(absolutePaths)
      let { EmployeeNoUnmanaged } = model.entities
      expect(inferredInline.elements)
        .to.deep.equal(inferredAbsolute.elements)
        .to.deep.equal({
          office_floor: EmployeeNoUnmanaged.elements.office.elements.address.elements.city,
          office_room: EmployeeNoUnmanaged.elements.office.elements.room,
          office_building: EmployeeNoUnmanaged.elements.office.elements.building,
          office_address: {
            elements: EmployeeNoUnmanaged.elements.office.elements.address.elements,
          },
          office_furniture: {
            elements: EmployeeNoUnmanaged.elements.office.elements.furniture.elements,
          },
        })
    })
    it('smart wildcard - column overwrite before *', () => {
      // office.furniture.chairs replaces office.furniture
      let queryInlineNotation = CQL`select from EmployeeNoUnmanaged {
        office.{'skip' as building, furniture.chairs as furniture, *, 'replace' as floor}
      }`
      let absolutePaths = CQL`select from EmployeeNoUnmanaged {
        'skip' as office_building,
        office.furniture.chairs as office_furniture,
        'replace' as office_floor,
        office.room,
        office.address
      }`
      let inferredInline = _inferred(queryInlineNotation)
      let inferredAbsolute = _inferred(absolutePaths)
      let { EmployeeNoUnmanaged } = model.entities
      expect(inferredInline.elements)
        .to.deep.equal(inferredAbsolute.elements)
        .to.deep.equal({
          office_building: { type: 'cds.String' },
          office_furniture: EmployeeNoUnmanaged.elements.office.elements.furniture.elements.chairs,
          office_floor: { type: 'cds.String' },
          office_room: EmployeeNoUnmanaged.elements.office.elements.room,
          office_address: {
            elements: EmployeeNoUnmanaged.elements.office.elements.address.elements,
          },
        })
    })

    // TODO negative test for wildcard expansion of unmanaged association!
    // rewritting in toplevel doesnt work either

    it('smart wildcard only works in local scope', () => {
      // duplicate error, as * already contains a field "office_address"
      let queryInlineNotation = CQL`select from Employee {
        office.*,
        office.address.city as office_address
      }`
      expect(() => _inferred(queryInlineNotation)).to.throw(/Duplicate definition of element “office_address”/)
    })

    it('wildcard - excluding elements from inline', () => {
      let queryInlineNotation = CQL`select from EmployeeNoUnmanaged {
        office.{*} excluding { building, address }
      }`
      let absolutePaths = CQL`select from EmployeeNoUnmanaged {
        office.floor,
        office.room,
        office.furniture
      }`
      let inferredInline = _inferred(queryInlineNotation)
      let inferredAbsolute = _inferred(absolutePaths)
      let { EmployeeNoUnmanaged } = model.entities
      expect(inferredInline.elements).to.deep.equal(inferredAbsolute.elements).to.deep.equal({
        office_floor: EmployeeNoUnmanaged.elements.office.elements.floor,
        office_room: EmployeeNoUnmanaged.elements.office.elements.room,
        office_furniture: EmployeeNoUnmanaged.elements.office.elements.furniture,
      })
    })
    it('wildcard - sql style on table alias', () => {
      let queryInlineNotation = CQL`select from EmployeeNoUnmanaged as E {
        E.{*}
      }`
      let queryInlineNotationWithoutBrackets = CQL`select from EmployeeNoUnmanaged as E {
        E.*
      }`
      let regularWildcard = CQL`select from EmployeeNoUnmanaged as E{
        *
      }`
      let inferredWithoutBrackets = _inferred(queryInlineNotation)
      let inferredWithBrackets = _inferred(queryInlineNotationWithoutBrackets)
      let inferredWildcard = _inferred(regularWildcard)
      let { EmployeeNoUnmanaged } = model.entities
      expect(inferredWithoutBrackets.elements)
        .to.deep.equal(inferredWithBrackets.elements)
        .to.deep.equal(inferredWildcard.elements)
        .to.deep.equal(EmployeeNoUnmanaged.elements)
    })
    it('wildcard - sql style on table alias with excluding', () => {
      let queryInlineNotation = CQL`select from EmployeeNoUnmanaged as E {
        E.{ *, office.room as office } excluding { department }
      }`
      let regularWildcard = CQL`select from EmployeeNoUnmanaged as E{
        *,
        office.room as office
      } excluding { department }`
      let inferredShortcut = _inferred(queryInlineNotation)
      let inferredAbsolute = _inferred(regularWildcard)
      let { EmployeeNoUnmanaged } = model.entities
      expect(inferredShortcut.elements).to.deep.equal(inferredAbsolute.elements).to.deep.equal({
        id: EmployeeNoUnmanaged.elements.id,
        name: EmployeeNoUnmanaged.elements.name,
        job: EmployeeNoUnmanaged.elements.job,
        office: EmployeeNoUnmanaged.elements.office.elements.room,
      })
    })

    it('wildcard - sql style on table alias with excluding and hand written joins', () => {
      let queryInlineNotation = CQL`select from EmployeeNoUnmanaged as E join Department as D on E.department.id = D.id {
        E.{ *, office.room as office } excluding { department },
        D.name as depName
      }`
      let inferredShortcut = _inferred(queryInlineNotation)
      let { EmployeeNoUnmanaged, Department } = model.entities
      expect(inferredShortcut.elements).to.deep.equal({
        id: EmployeeNoUnmanaged.elements.id,
        name: EmployeeNoUnmanaged.elements.name,
        job: EmployeeNoUnmanaged.elements.job,
        office: EmployeeNoUnmanaged.elements.office.elements.room,
        depName: Department.elements.name,
      })
    })
  })
})
