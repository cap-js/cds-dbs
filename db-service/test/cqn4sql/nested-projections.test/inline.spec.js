'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')

const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('(nested projections) inline', () => {
  before(async () => {
    const m = await loadModel()
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = (q, flat = false) => orig(q, flat ? cds.compile.for.nodejs(m) : m)
  })

  describe('structures only', () => {
    it('simple', () => {
      const inlineQuery = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          office.{
            floor,
            room
          }
        }`

      const longVersion = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          office.floor,
          office.room
        }`

      const expected = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          Employee.office_floor,
          Employee.office_room
        }`

      const inlineTransformed = cqn4sql(inlineQuery)
      const longTransformed = cqn4sql(longVersion)

      expectCqn(inlineTransformed).to.equal(longTransformed)
      expectCqn(longTransformed).to.equal(expected)
    })

    it('xpr', () => {
      const inlineQuery = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          office.{
            1 + 1 as zwei,
            floor || ' ' || room as combined,
          }
        }`

      const expected = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          (1 + 1) as office_zwei,
          (Employee.office_floor || ' ' || Employee.office_room) as office_combined
        }`

      const transformed = cqn4sql(inlineQuery)

      expectCqn(transformed).to.equal(expected)
    })

    it('assigning alias within inline only influences name of element, prefix still appended', () => {
      const inline = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office.{ floor as x }
        }`

      const expected = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          EmployeeNoUnmanaged.office_floor as office_x,
        }`

      const transformed = cqn4sql(inline)

      expectCqn(transformed).to.equal(expected)
    })

    it('deep', () => {
      const queryInlineNotation = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          office.{
            floor,
            address.{
              city,
              street,
              country.{ code }
            }
          }
        }`

      const variantWithoutInline = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          office.floor,
          office.address.city,
          office.address.street,
          office.address.country.code
        }`

      const expected = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          Employee.office_floor,
          Employee.office_address_city,
          Employee.office_address_street,
          Employee.office_address_country_code
        }`

      const inlineTransformed = cqn4sql(queryInlineNotation)
      const variantTransformed = cqn4sql(variantWithoutInline)

      expectCqn(inlineTransformed).to.equal(variantTransformed)
      expectCqn(variantTransformed).to.equal(expected)
    })
  })

  describe('associations only', () => {
    it('inlined path expression', () => {
      const inlineQuery = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          department.{
            name
          }
        }`

      const expected = cds.ql`
        SELECT from nestedProjections.Employee as Employee
          left join nestedProjections.Department as department on department.id = Employee.department_id
        {
          department.name as department_name
        }`

      const transformed = cqn4sql(inlineQuery)

      expectCqn(transformed).to.equal(expected)
    })

    it('infix filter at leaf', () => {
      const inlineQuery = cds.ql`
        SELECT from nestedProjections.Department as Department
        {
          head[job = 'boss'].{
            name,
            job
          }
        }`

      const expected = cds.ql`
        SELECT from nestedProjections.Department as Department
          left join nestedProjections.Employee as head on head.id = Department.head_id
            and head.job = 'boss'
        {
          head.name as head_name,
          head.job as head_job
        }`

      const transformed = cqn4sql(inlineQuery)

      expectCqn(transformed).to.equal(expected)
    })

    it('path expression roundtrip', () => {
      const inlineQuery = cds.ql`
        SELECT from nestedProjections.Department as Department
        {
          head.department.{
            costCenter
          }
        }`

      const expected = cds.ql`
        SELECT from nestedProjections.Department as Department
          left join nestedProjections.Employee as head on head.id = Department.head_id
          left join nestedProjections.Department as department2 on department2.id = head.department_id
        {
          department2.costCenter as head_department_costCenter,
        }`

      const transformed = cqn4sql(inlineQuery)

      expectCqn(transformed).to.equal(expected)
    })
    it('join relevant path within inlined projection', () => {
      const queryInlineNotation = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          office.{
            floor,
            address.{
              city,
              street,
              country.{ population }
            }
          }
        }`

      const expected = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        left join nestedProjections.Country as country on country.code = Employee.office_address_country_code
        {
          Employee.office_floor,
          Employee.office_address_city,
          Employee.office_address_street,
          country.population as office_address_country_population
        }`

      const inlineTransformed = cqn4sql(queryInlineNotation)

      expectCqn(inlineTransformed).to.equal(expected)
    })
  })

  describe('mixed structures and associations', () => {
    it('via association with infix filter to structure', () => {
      const inlineQuery = cds.ql`
        SELECT from nestedProjections.Department as Department
        {
          head[job = 'boss'].office.{
            floor
          }
        }`

      const expected = cds.ql`
        SELECT from nestedProjections.Department as Department
          left join nestedProjections.Employee as head on head.id = Department.head_id
            and head.job = 'boss'
        {
          head.office_floor as head_office_floor,
        }`

      const transformed = cqn4sql(inlineQuery)

      expectCqn(transformed).to.equal(expected)
    })

    it('path expression within inline', () => {
      const inlineQuery = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          office.{
            floor,
            building.name
          }
        }`

      const longVersion = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          office.floor,
          office.building.name
        }`

      const expected = cds.ql`
        SELECT from nestedProjections.Employee as Employee
          left join nestedProjections.Building as building on building.id = Employee.office_building_id
        {
          Employee.office_floor,
          building.name as office_building_name
        }`

      const inlineTransformed = cqn4sql(inlineQuery)
      const longTransformed = cqn4sql(longVersion)

      expectCqn(inlineTransformed).to.equal(longTransformed)
      expectCqn(longTransformed).to.equal(expected)
    })
    it('xpr with join relevant filter', () => {
      const inlineQuery = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          office.{
            (address.country[code = 'EN'].population + 10) || ' ' || building as combined,
            address.country.{ code || 'FOO' as code }
          }
        }`

      const expected = cds.ql`
        SELECT from nestedProjections.Employee as Employee
          left join nestedProjections.Country as country on country.code = Employee.office_address_country_code
            and country.code = 'EN'
        {
          ((country.population + 10) || ' ' || Employee.office_building_id) as office_combined,
          (Employee.office_address_country_code || 'FOO') as office_address_country_code
        }`

      const transformed = cqn4sql(inlineQuery)

      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('mixed with expands', () => {
    it('on structures', () => {
      const queryInlineNotation = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          office
          {
            floor,
            address.{
              city,
              street
            }
          }
        }`

      const variantWithoutInline = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          office
          {
            floor,
            address.city,
            address.street
          }
        }`

      const expected = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          Employee.office_floor,
          Employee.office_address_city,
          Employee.office_address_street
        }`

      const inlineTransformed = cqn4sql(queryInlineNotation)
      const variantTransformed = cqn4sql(variantWithoutInline)

      expectCqn(inlineTransformed).to.equal(variantTransformed)
      expectCqn(variantTransformed).to.equal(expected)
    })

    it('same as above but interchanged expand and inline', () => {
      const queryInlineNotation = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          office.{
            floor,
            address
            {
              city,
              street
            }
          }
        }`

      const variantWithoutInline = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          office.floor,
          office.address
          {
            city,
            street
          }
        }`

      const expected = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          Employee.office_floor,
          Employee.office_address_city,
          Employee.office_address_street,
        }`

      const inlineTransformed = cqn4sql(queryInlineNotation)
      const variantTransformed = cqn4sql(variantWithoutInline)

      expectCqn(inlineTransformed).to.equal(variantTransformed)
      expectCqn(variantTransformed).to.equal(expected)
    })

    it('deep expand on assoc within inlined strictire', () => {
      const queryInlineNotation = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          office.{
            floor,
            building
            {
              id
            }
          }
        }`

      const variantWithoutInline = cds.ql`
        SELECT from nestedProjections.Employee as Employee
        {
          office.floor,
          office.building
          {
            id
          }
        }`

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

      const inlineTransformed = cqn4sql(queryInlineNotation)
      const variantTransformed = cqn4sql(variantWithoutInline)

      // expand subqueries have special non-enumerable props -> ignore them
      expectCqn(inlineTransformed).to.equal(variantTransformed)
      expectCqn(variantTransformed).to.equal(expected)
    })
  })

  describe('wildcards', () => {
    it('toplevel', () => {
      const inlineWildcard = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office.{ * }
        }`

      const inlineExplicit = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office.{
            floor,
            room,
            building,
            address,
            furniture
          }
        }`

      const absolutePaths = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office.floor,
          office.room,
          office.building,
          office.address,
          office.furniture
        }`

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

      const wildcard = cqn4sql(inlineWildcard)
      const explicit = cqn4sql(inlineExplicit)
      const absolute = cqn4sql(absolutePaths)

      expectCqn(wildcard).to.equal(explicit)
      expectCqn(explicit).to.equal(absolute)
      expectCqn(absolute).to.equal(expected)
    })

    it('deep w/o brackets', () => {
      const inline = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office.{ address.* }
        }`

      const absolutePaths = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office.address.city,
          office.address.street,
          office.address.country,
        }`

      const expected = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          EmployeeNoUnmanaged.office_address_city,
          EmployeeNoUnmanaged.office_address_street,
          EmployeeNoUnmanaged.office_address_country_code,
        }`

      const inlineTransformed = cqn4sql(inline)
      const absoluteTransformed = cqn4sql(absolutePaths)

      expectCqn(inlineTransformed).to.equal(absoluteTransformed)
      expectCqn(absoluteTransformed).to.equal(expected)
    })

    it('smart wildcard - assoc overwrite after *', () => {
      // office.address.city replaces office.floor
      const inline = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office.{ *, furniture as building, address.city as floor, building.id as room }
        }`

      const absolutePaths = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office.address.city as office_floor,
          office.building.id as office_room,
          office.furniture as office_building,
          office.address,
          office.furniture
        }`

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

      const inlineTransformed = cqn4sql(inline)
      const absoluteTransformed = cqn4sql(absolutePaths)

      expectCqn(inlineTransformed).to.equal(absoluteTransformed)
      expectCqn(absoluteTransformed).to.equal(expected)
    })

    it('smart wildcard - structure overwritten by assoc before *', () => {
      // intermediate structures are overwritten
      const inline = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office.{ building as furniture, * }
        }`

      const absolutePaths = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office.building as office_furniture,
          office.floor,
          office.room,
          office.building,
          office.address
        }`

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

      const inlineTransformed = cqn4sql(inline)
      const absoluteTransformed = cqn4sql(absolutePaths)

      expectCqn(inlineTransformed).to.equal(absoluteTransformed)
      expectCqn(absoluteTransformed).to.equal(expected)
    })

    it('smart wildcard - structure overwritten by join relevant assoc before *', () => {
      // intermediate structures are overwritten
      const inline = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office.{ building[name='mega tower'].name as furniture, * }
        }`

      const absolutePaths = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office.building[name='mega tower'].name as office_furniture,
          office.floor,
          office.room,
          office.building,
          office.address
        }`

      const expected = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
          left join nestedProjections.Building as building on building.id = EmployeeNoUnmanaged.office_building_id and building.name = 'mega tower'
        {
          building.name as office_furniture,
          EmployeeNoUnmanaged.office_floor,
          EmployeeNoUnmanaged.office_room,
          EmployeeNoUnmanaged.office_building_id,
          EmployeeNoUnmanaged.office_address_city,
          EmployeeNoUnmanaged.office_address_street,
          EmployeeNoUnmanaged.office_address_country_code
        }`

      const inlineTransformed = cqn4sql(inline)
      const absoluteTransformed = cqn4sql(absolutePaths)

      expectCqn(inlineTransformed).to.equal(absoluteTransformed)
      expectCqn(absoluteTransformed).to.equal(expected)
    })

    it('no overwrite but additional cols', () => {
      const inline = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office.{ *, 'foo' as last }
        }`

      const absolutePaths = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office.floor,
          office.room,
          office.building,
          office.address,
          office.furniture,
          'foo' as office_last
        }`

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

      const inlineTransformed = cqn4sql(inline)
      const absoluteTransformed = cqn4sql(absolutePaths)

      expectCqn(inlineTransformed).to.equal(absoluteTransformed)
      expectCqn(absoluteTransformed).to.equal(expected)
    })

    it('smart wildcard - structured overwrite before *', () => {
      // intermediate structures are overwritten
      const inline = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office.{ 'first' as furniture, 'second' as building, * }
        }`

      const absolutePaths = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          'first' as office_furniture,
          'second' as office_building,
          office.floor,
          office.room,
          office.address
        }`

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

      const inlineTransformed = cqn4sql(inline)
      const absoluteTransformed = cqn4sql(absolutePaths)

      expectCqn(inlineTransformed).to.equal(absoluteTransformed)
      expectCqn(absoluteTransformed).to.equal(expected)
    })

    it('smart wildcard - structured overwrite after *', () => {
      // intermediate structures are overwritten
      const inline = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office.{*, 'third' as building, 'fourth' as address }
        }`

      const absolutePaths = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office.floor,
          office.room,
          'third' as office_building,
          'fourth' as office_address,
          office.furniture
        }`

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

      const inlineTransformed = cqn4sql(inline)
      const absoluteTransformed = cqn4sql(absolutePaths)

      expectCqn(inlineTransformed).to.equal(absoluteTransformed)
      expectCqn(absoluteTransformed).to.equal(expected)
    })

    it('exclude association', () => {
      // intermediate structures are overwritten
      const inline = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office.{*} excluding { building, address }
        }`

      const absolutePaths = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          office.floor,
          office.room,
          office.furniture
        }`

      const expected = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as EmployeeNoUnmanaged
        {
          EmployeeNoUnmanaged.office_floor,
          EmployeeNoUnmanaged.office_room,
          EmployeeNoUnmanaged.office_furniture_chairs,
          EmployeeNoUnmanaged.office_furniture_desks
        }`

      const inlineTransformed = cqn4sql(inline)
      const absoluteTransformed = cqn4sql(absolutePaths)

      expectCqn(inlineTransformed).to.equal(absoluteTransformed)
      expectCqn(absoluteTransformed).to.equal(expected)
    })

    it('sql style wildcard on table alias', () => {
      const inline = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
        {
          E.*
        }`

      const inlineWithBrackets = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
        {
          E.{*}
        }`

      const regularWildcard = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
        {
          *
        }`

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

      const inlineTransformed = cqn4sql(inline)
      const inlineWithBracketsTransformed = cqn4sql(inlineWithBrackets)
      const regularTransformed = cqn4sql(regularWildcard)

      expectCqn(inlineTransformed).to.equal(inlineWithBracketsTransformed)
      expectCqn(inlineWithBracketsTransformed).to.equal(regularTransformed)
      expectCqn(regularTransformed).to.equal(expected)
    })

    it('sql style wildcard on table alias - exclude stuff', () => {
      const inlineWithBrackets = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
        {
          E.{*} excluding { office }
        }`

      const regularWildcard = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
        {
          *
        } excluding { office }`

      const expected = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
        {
          E.id,
          E.name,
          E.job,
          E.department_id
        }`

      const inlineTransformed = cqn4sql(inlineWithBrackets)
      const regularTransformed = cqn4sql(regularWildcard)

      expectCqn(inlineTransformed).to.equal(expected)
      expectCqn(inlineTransformed).to.equal(regularTransformed)
    })

    it('wildcard on assoc', () => {
      const inlineWithBrackets = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
        {
          department.{*}
        }`

      const expected = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
          left join nestedProjections.Department as department on department.id = E.department_id
        {
          E.department_id,
          department.name as department_name,
          department.costCenter as department_costCenter,
          department.head_id as department_head_id
        }`

      const inlineTransformed = cqn4sql(inlineWithBrackets)

      expectCqn(inlineTransformed).to.equal(expected)
    })

    it('wildcard on assoc with filter', () => {
      const inlineWithBrackets = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
        {
          department[name = 'Bar'].{*}
        }`

      const expected = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
          left join nestedProjections.Department as department on department.id = E.department_id
            and department.name = 'Bar'
        {
          department.id,
          department.name as department_name,
          department.costCenter as department_costCenter,
          department.head_id as department_head_id
        }`

      const inlineTransformed = cqn4sql(inlineWithBrackets)

      expectCqn(inlineTransformed).to.equal(expected)
    })

    it('wildcard on assoc with excluding', () => {
      const inlineWithBrackets = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
        {
          department.{*} excluding { head }
        }`

      const expected = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
          left join nestedProjections.Department as department on department.id = E.department_id
        {
          E.department_id,
          department.name as department_name,
          department.costCenter as department_costCenter
        }`

      const inlineTransformed = cqn4sql(inlineWithBrackets)

      expectCqn(inlineTransformed).to.equal(expected)
    })

    it('wildcard on assoc with overwrite before *', () => {
      const inlineWithBrackets = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
        {
          department.{ 'custom' as name, * }
        }`

      const expected = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
          left join nestedProjections.Department as department on department.id = E.department_id
        {
          'custom' as department_name,
          E.department_id,
          department.costCenter as department_costCenter,
          department.head_id as department_head_id
        }`

      const inlineTransformed = cqn4sql(inlineWithBrackets)

      expectCqn(inlineTransformed).to.equal(expected)
    })

    it('wildcard on assoc with overwrite after *', () => {
      const inlineWithBrackets = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
        {
          department.{ *, 'custom' as costCenter }
        }`

      const expected = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
          left join nestedProjections.Department as department on department.id = E.department_id
        {
          E.department_id,
          department.name as department_name,
          'custom' as department_costCenter,
          department.head_id as department_head_id
        }`

      const inlineTransformed = cqn4sql(inlineWithBrackets)

      expectCqn(inlineTransformed).to.equal(expected)
    })

    it('wildcard on assoc with additional columns', () => {
      const inlineWithBrackets = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
        {
          department.{ *, 'extra' as extra }
        }`

      const expected = cds.ql`
        SELECT from nestedProjections.EmployeeNoUnmanaged as E
          left join nestedProjections.Department as department on department.id = E.department_id
        {
          E.department_id,
          department.name as department_name,
          department.costCenter as department_costCenter,
          department.head_id as department_head_id,
          'extra' as department_extra
        }`

      const inlineTransformed = cqn4sql(inlineWithBrackets)

      expectCqn(inlineTransformed).to.equal(expected)
    })
  })
})
