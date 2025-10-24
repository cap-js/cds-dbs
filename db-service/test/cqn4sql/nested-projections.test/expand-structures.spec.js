'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')

const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('(nested projections) expand structures', () => {
  before(async () => {
    const m = await loadModel()
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = (q, flat = false) => orig(q, flat ? cds.compile.for.nodejs(m) : m)
  })

  describe('basic', () => {
    it('with one leaf', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          dedication { addressee }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          Books.ID,
          Books.dedication_addressee_ID,
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('multiple leafs, deeply nested', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          dedication {
            addressee,
            sub { foo }
          }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          Books.ID,
          Books.dedication_addressee_ID,
          Books.dedication_sub_foo,
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('with join relevant path expression', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          ID,
          dedication { addressee.name }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as $B
          left outer join bookshop.Person as addressee on addressee.ID = $B.dedication_addressee_ID
        {
          $B.ID,
          addressee.name as dedication_addressee_name
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('with join relevant path expression w/ infix filter', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          ID,
          dedication { addressee[ID=42].name }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as $B
          left join bookshop.Person as addressee
            on addressee.ID = $B.dedication_addressee_ID
              and addressee.ID = 42
        {
          $B.ID,
          addressee.name as dedication_addressee_name
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('structured expand with deep assoc expand', () => {
      // Implicit alias of nested expand subquery is the first letter
      // of the column alias
      const transformed = cqn4sql(cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          office
          {
            floor,
            address
            {
              city,
              street,
              country { code }
            }
          }
        }`)

      const expected = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          Employee.office_floor,
          Employee.office_address_city,
          Employee.office_address_street,
          (
            SELECT
              $o.code
            from nestedProjections.Country as $o
            where Employee.office_address_country_code = $o.code
          ) as office_address_country
        }`

      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('wildcard', () => {
    it('substructure w/ wildcard', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          dedication {
            addressee,
            sub { * }
          }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          Books.ID,
          Books.dedication_addressee_ID,
          Books.dedication_sub_foo,
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('wildcard also applied to substructures', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          dedication { * }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          Books.ID,
          Books.dedication_addressee_ID,
          Books.dedication_text,
          Books.dedication_sub_foo,
          Books.dedication_dedication,
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('rename wildcard base', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID as foo,
          dedication as bubu {
            addressee,
            sub { * }
          }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          Books.ID as foo,
          Books.dedication_addressee_ID as bubu_addressee_ID,
          Books.dedication_sub_foo as bubu_sub_foo,
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('order by element which comes from wildcard', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          dedication as bubu {
            addressee,
            sub { * }
          }
        } order by bubu.sub.foo`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          Books.ID,
          Books.dedication_addressee_ID as bubu_addressee_ID,
          Books.dedication_sub_foo as bubu_sub_foo,
        } order by bubu_sub_foo`

      expectCqn(transformed).to.equal(expected)
    })

    it('respect order', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          dedication { text, * }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          Books.dedication_text,
          Books.dedication_addressee_ID,
          Books.dedication_sub_foo,
          Books.dedication_dedication,
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('overwrite wildcard elements (smart wildcard)', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books as Books
        {
          ID,
          dedication { *, 5 as text }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as Books
        {
          Books.ID,
          Books.dedication_addressee_ID,
          5 as dedication_text,
          Books.dedication_sub_foo,
          Books.dedication_dedication,
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('overwrite wildcard elements (smart wildcard) and respect order', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books
        {
          dedication { 'first' as first, 'second' as sub, *, 5 as ![5], 'Baz' as text }
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as $B
        {
          'first' as dedication_first,
          'second' as dedication_sub,
          $B.dedication_addressee_ID,
          'Baz' as dedication_text,
          $B.dedication_dedication,
          5 as dedication_5
        }`

      expectCqn(transformed).to.equal(expected)
    })
  })

  // same tests as in `inline-structures.spec.js`
  // `.inline` and `.expand` on a `struct` are semantically equivalent
  describe('expand and inline on structures are semantically equivalent', () => {
    it('simple structural expansion', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          office
          {
            floor,
            room
          }
        }`)

      const expected = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          Employee.office_floor,
          Employee.office_room
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('structural expansion with path expression', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          office
          {
            floor,
            building.name
          }
        }`)

      const expected = cds.ql`
        SELECT from nestedProjections.Employee as Employee
          left join nestedProjections.Building as building on building.id = Employee.office_building_id
        {
          Employee.office_floor,
          building.name as office_building_name
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('deep', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          office
          {
            floor,
            address
            {
              city,
              street
            }
          }
        }`)

      const expected = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          Employee.office_floor,
          Employee.office_address_city,
          Employee.office_address_street
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('multi expand with star - foreign key must survive in flat mode', () => {
      const transformed = cqn4sql(
        cds.ql`
      SELECT from nestedProjections.Employee
      {
        *,
        department
        {
          id,
          name
        },
        assets
        {
          id,
          descr
        }
      } excluding
      {
        office_floor,
        office_address_country,
        office_building,
        office_room,
        office_building_id,
        office_address_city,
        office_building_id,
        office_address_street,
        office_address_country_code,
        office_address_country_code,
        office_furniture_chairs,
        office_furniture_desks
      }`,
        true,
      )

      const expected = cds.ql`
      SELECT from nestedProjections.Employee as $E
      {
        $E.id,
        $E.name,
        $E.job,
        $E.department_id,
        (
          SELECT
            $d.id,
            $d.name
          from nestedProjections.Department as $d
          where $E.department_id = $d.id
        ) as department,
        (
          SELECT
            $a.id,
            $a.descr
          from nestedProjections.Assets as $a
          where $E.id = $a.owner_id
        ) as assets
      }`

      expectCqn(transformed).to.equal(expected)
    })

    it('multi expand with star but foreign key does not survive in structured mode', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from nestedProjections.Employee
        {
          *,
          department
          {
            id,
            name
          },
          assets
          {
            id,
            descr
          }
        } excluding
        {
          office
        }`)

      const expected = cds.ql`
        SELECT from nestedProjections.Employee as $E
        {
          $E.id,
          $E.name,
          $E.job,
          (
            SELECT
              $d.id,
              $d.name
            from nestedProjections.Department as $d
            where $E.department_id = $d.id
          ) as department,
          (
            SELECT
              $a.id,
              $a.descr
            from nestedProjections.Assets as $a
            where $E.id = $a.owner_id
          ) as assets
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('deeply structured expand', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          office
          {
            floor,
            address
            {
              city,
              street
            }
          }
        }`)

      const expected = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          Employee.office_floor,
          Employee.office_address_city,
          Employee.office_address_street,
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('expand on assoc within structure expand', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          office
          {
            floor,
            building
            {
              id
            }
          }
        }`)

      const expected = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          Employee.office_floor,
          (
            SELECT
              $o.id
            from nestedProjections.Building as $o
            where Employee.office_building_id = $o.id
          ) as office_building
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('wildcard toplevel', () => {
      const wildcard = cqn4sql(cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office { * }
        }`)

      const absolute = cqn4sql(cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office.floor,
          office.room,
          office.building,
          office.address,
          office.furniture
        }`)

      const expected = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          EmployeeNoUnmanaged.office_floor,
          EmployeeNoUnmanaged.office_room,
          EmployeeNoUnmanaged.office_building_id,
          EmployeeNoUnmanaged.office_address_city,
          EmployeeNoUnmanaged.office_address_street,
          EmployeeNoUnmanaged.office_address_country_code,
          EmployeeNoUnmanaged.office_furniture_chairs,
          EmployeeNoUnmanaged.office_furniture_desks
        }`

      expectCqn(wildcard).to.equal(absolute)
      expectCqn(absolute).to.equal(expected)
    })

    it('wildcard deep', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office { address {*} }
        }`)

      const expected = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          EmployeeNoUnmanaged.office_address_city,
          EmployeeNoUnmanaged.office_address_street,
          EmployeeNoUnmanaged.office_address_country_code,
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('smart wildcard - assoc overwrite after *', () => {
      // office.address.city replaces office.floor
      const transformed = cqn4sql(cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office
          {
            *,
            furniture as building,
            address.city as floor,
            building.id as room
          }
        }`)

      const expected = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          EmployeeNoUnmanaged.office_address_city as office_floor,
          EmployeeNoUnmanaged.office_building_id as office_room,
          EmployeeNoUnmanaged.office_furniture_chairs as office_building_chairs,
          EmployeeNoUnmanaged.office_furniture_desks as office_building_desks,
          EmployeeNoUnmanaged.office_address_city,
          EmployeeNoUnmanaged.office_address_street,
          EmployeeNoUnmanaged.office_address_country_code,
          EmployeeNoUnmanaged.office_furniture_chairs,
          EmployeeNoUnmanaged.office_furniture_desks
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('smart wildcard - structure overwritten by assoc before *', () => {
      // intermediate structures are overwritten
      const transformed = cqn4sql(cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office { building as furniture, * }
        }`)

      const expected = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          EmployeeNoUnmanaged.office_building_id as office_furniture_id,
          EmployeeNoUnmanaged.office_floor,
          EmployeeNoUnmanaged.office_room,
          EmployeeNoUnmanaged.office_building_id,
          EmployeeNoUnmanaged.office_address_city,
          EmployeeNoUnmanaged.office_address_street,
          EmployeeNoUnmanaged.office_address_country_code
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('wildcard - no overwrite but additional cols', () => {
      // intermediate structures are overwritten
      const transformed = cqn4sql(cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office
          {
            *,
            'foo' as last
          }
        }`)

      const expected = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          EmployeeNoUnmanaged.office_floor,
          EmployeeNoUnmanaged.office_room,
          EmployeeNoUnmanaged.office_building_id,
          EmployeeNoUnmanaged.office_address_city,
          EmployeeNoUnmanaged.office_address_street,
          EmployeeNoUnmanaged.office_address_country_code,
          EmployeeNoUnmanaged.office_furniture_chairs,
          EmployeeNoUnmanaged.office_furniture_desks,
          'foo' as office_last
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('assigning alias within expand only influences name of element, prefix still appended', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office { floor as x }
        }`)

      const expected = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          EmployeeNoUnmanaged.office_floor as office_x,
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('smart wildcard - structured overwrite before *', () => {
      // intermediate structures are overwritten
      const transformed = cqn4sql(cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office { 'first' as furniture, 'second' as building, * }
        }`)

      const expected = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          'first' as office_furniture,
          'second' as office_building,
          EmployeeNoUnmanaged.office_floor,
          EmployeeNoUnmanaged.office_room,
          EmployeeNoUnmanaged.office_address_city,
          EmployeeNoUnmanaged.office_address_street,
          EmployeeNoUnmanaged.office_address_country_code,
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('smart wildcard - structured overwrite after *', () => {
      // intermediate structures are overwritten and inserted in-place
      const transformed = cqn4sql(cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office
          {
            *,
            'third' as building,
            'fourth' as address
          }
        }`)

      const expected = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          EmployeeNoUnmanaged.office_floor,
          EmployeeNoUnmanaged.office_room,
          'third' as office_building,
          'fourth' as office_address,
          EmployeeNoUnmanaged.office_furniture_chairs,
          EmployeeNoUnmanaged.office_furniture_desks
        }`

      expectCqn(transformed).to.equal(expected)
    })

    it('wildcard expansion - exclude association', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office {*}
            excluding { building, address }
        }`)

      const expected = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          EmployeeNoUnmanaged.office_floor,
          EmployeeNoUnmanaged.office_room,
          EmployeeNoUnmanaged.office_furniture_chairs,
          EmployeeNoUnmanaged.office_furniture_desks
        }`

      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('SQL Style table alias expansion', () => {
    it('with explicit table alias', () => {
      const expanded = cqn4sql(cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
        {
          E {*}
        }`)

      const regular = cqn4sql(cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
        {
          *
        }`)

      const expected = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
        {
          E.id,
          E.name,
          E.job,
          E.department_id,
          E.office_floor,
          E.office_room,
          E.office_building_id,
          E.office_address_city,
          E.office_address_street,
          E.office_address_country_code,
          E.office_furniture_chairs,
          E.office_furniture_desks,
        }`

      expectCqn(expanded).to.equal(regular)
      expectCqn(regular).to.equal(expected)
    })

    it('with explicit table alias - exclude stuff', () => {
      const expanded = cqn4sql(cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
        {
          E {*}
            excluding { office }
        }`)

      const regular = cqn4sql(cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
        {
          *
        } excluding { office }`)

      const expected = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
        {
          E.id,
          E.name,
          E.job,
          E.department_id
        }`

      expectCqn(expanded).to.equal(expected)
      expectCqn(expanded).to.equal(regular)
    })

    it('without explicit table alias - exclude stuff', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
        {
          {*} excluding { office } as FOO
        }`)

      const expected = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
        {
          E.FOO_id,
          E.FOO_name,
          E.FOO_job,
          E.FOO_department_id
        }`

      expectCqn(transformed).to.equal(expected)
    })
  })
})
