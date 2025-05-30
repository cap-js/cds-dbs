'use strict'

const _cqn4sql = require('../../lib/cqn4sql')
function cqn4sql(q, model = cds.model) {
  return _cqn4sql(q, model)
}
const cds = require('@sap/cds')
const { expect } = cds.test
describe('inline', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await await cds.load(`${__dirname}/model/nestedProjections`).then(cds.linked)
  })

  it('simple structural inline expansion', () => {
    let inlineQuery = cds.ql`select from Employee as Employee {
      office.{
        floor,
        room
      }
    }`
    let longVersion = cds.ql`select from Employee as Employee {
      office.floor,
      office.room
    }`
    let expected = cds.ql`select from Employee as Employee {
      Employee.office_floor,
      Employee.office_room
    }`
    expect(cqn4sql(inlineQuery, model)).to.eql(cqn4sql(longVersion, model)).to.eql(expected)
  })
  it('structural inline expansion with path expression', () => {
    let inlineQuery = cds.ql`select from Employee as Employee {
      office.{
        floor,
        building.name
      }
    }`
    let longVersion = cds.ql`select from Employee as Employee {
      office.floor,
      office.building.name
    }`
    let expected = cds.ql`select from Employee as Employee
    left join Building as building on building.id = Employee.office_building_id
    {
      Employee.office_floor,
      building.name as office_building_name
    }`
    const longResult = cqn4sql(longVersion, model)
    expect(cqn4sql(inlineQuery, model)).to.eql(longResult).to.eql(expected)
  })
  it('inline expansion with path expression', () => {
    let inlineQuery = cds.ql`select from Employee as Employee {
      department.{
        name
      }
    }`
    let expected = cds.ql`select from Employee as Employee
    left join Department as department on department.id = Employee.department_id
    {
      department.name as department_name
    }`
    expect(cqn4sql(inlineQuery, model)).to.eql(expected)
  })
  it('structural inline expansion with path expression and infix filter', () => {
    let inlineQuery = cds.ql`select from Department as Department {
      head[job = 'boss'].office.{
        floor
      }
    }`
    let expected = cds.ql`select from Department as Department
    left join Employee as head on head.id = Department.head_id
        and head.job = 'boss'
    {
      head.office_floor as head_office_floor,
    }`
    expect(cqn4sql(inlineQuery, model)).to.eql(expected)
  })
  it('structural inline expansion with path expression and infix filter at leaf', () => {
    let inlineQuery = cds.ql`select from Department as Department {
      head[job = 'boss'].{
        name
      }
    }`
    let expected = cds.ql`select from Department as Department
    left join Employee as head on head.id = Department.head_id
        and head.job = 'boss'
    {
      head.name as head_name,
    }`
    expect(cqn4sql(inlineQuery, model)).to.eql(expected)
  })

  it('structural inline expansion back and forth', () => {
    let inlineQuery = cds.ql`select from Department as Department {
      head.department.{
        costCenter
      }
    }`
    let expected = cds.ql`select from Department as Department
    left join Employee as head on head.id = Department.head_id
    left join Department as department2 on department2.id = head.department_id
    {
      department2.costCenter as head_department_costCenter,
    }`
    const res = cqn4sql(inlineQuery, model)
    expect(res).to.eql(expected)
  })

  it('structural inline expansion back and forth', () => {
    let inlineQuery = cds.ql`select from Department as Department {
      head.department.{
        costCenter
      }
    }`
    let expected = cds.ql`select from Department as Department
    left join Employee as head on head.id = Department.head_id
    left join Department as department2 on department2.id = head.department_id
    {
      department2.costCenter as head_department_costCenter,
    }`
    const res = cqn4sql(inlineQuery, model)
    expect(res).to.eql(expected)
  })

  it('mixed with expand', () => {
    let queryInlineNotation = cds.ql`select from Employee as Employee {
          office {
            floor,
            address.{
              city,
              street
            }
          }
    }`
    let variantWithoutInline = cds.ql`select from Employee as Employee {
      office {
        floor,
        address.city,
        address.street
      }
    }`
    let expected = cds.ql`SELECT from Employee as Employee {
        Employee.office_floor,
        Employee.office_address_city,
        Employee.office_address_street
    }`
    const inlineRes = cqn4sql(queryInlineNotation, model)
    expect(inlineRes).to.eql(cqn4sql(variantWithoutInline, model)).to.eql(expected)
  })

  it('deep inline', () => {
    let queryInlineNotation = cds.ql`select from Employee as Employee {
      office.{
        floor,
        address.{
          city,
          street,
          country.{code}
        }
      }
    }`
    let variantWithoutInline = cds.ql`select from Employee as Employee {
      office.floor,
      office.address.city,
      office.address.street,
      office.address.country.code
    }`
    let expected = cds.ql`select from Employee as Employee {
      Employee.office_floor,
      Employee.office_address_city,
      Employee.office_address_street,
      Employee.office_address_country_code
    }`
    expect(cqn4sql(queryInlineNotation, model)).to.eql(cqn4sql(variantWithoutInline, model)).to.eql(expected)
  })
  it('deep expand in inline', () => {
    let queryInlineNotation = cds.ql`select from Employee as Employee {
      office.{
        floor,
        address {
          city,
          street
        }
      }
    }`
    let variantWithoutInline = cds.ql`select from Employee as Employee {
      office.floor,
      office.address {
          city,
          street
      }
    }`
    let expected = cds.ql`select from Employee as Employee {
      Employee.office_floor,
      Employee.office_address_city,
      Employee.office_address_street,
    }`
    expect(cqn4sql(queryInlineNotation, model)).to.eql(cqn4sql(variantWithoutInline, model)).to.eql(expected)
  })
  it('deep expand on assoc in inline', () => {
    let queryInlineNotation = cds.ql`select from Employee as Employee {
      office.{
        floor,
        building {
          id
        }
      }
    }`
    let variantWithoutInline = cds.ql`select from Employee as Employee {
      office.floor,
      office.building {
          id
      }
    }`
    let expected = cds.ql`select from Employee as Employee {
      Employee.office_floor,
      (
        select $o.id from Building as $o
        where Employee.office_building_id = $o.id
      ) as office_building
    }`
    // expand subqueries have special non-enumerable props -> ignore them
    expect(JSON.parse(JSON.stringify(cqn4sql(queryInlineNotation, model))))
      .to.eql(JSON.parse(JSON.stringify(cqn4sql(variantWithoutInline, model))))
      .to.eql(expected)
  })

  it('wildcard inline toplevel', () => {
    let inlineWildcard = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
      office.{ * }
    }`
    let inlineExplicit = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
      office.{
        floor,
        room,
        building,
        address,
        furniture
      }
    }`
    let absolutePaths = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
      office.floor,
      office.room,
      office.building,
      office.address,
      office.furniture
    }`

    let expected = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
      EmployeeNoUnmanaged.office_floor,
      EmployeeNoUnmanaged.office_room,
      EmployeeNoUnmanaged.office_building_id,
      EmployeeNoUnmanaged.office_address_city,
      EmployeeNoUnmanaged.office_address_street,
      EmployeeNoUnmanaged.office_address_country_code,
      EmployeeNoUnmanaged.office_furniture_chairs,
      EmployeeNoUnmanaged.office_furniture_desks
    }`
    let wildcard = cqn4sql(inlineWildcard)
    let explicit = cqn4sql(inlineExplicit)
    let absolute = cqn4sql(absolutePaths)
    expect(wildcard).to.eql(explicit).to.eql(absolute).to.eql(expected)
  })
  it('wildcard inline deep w/o brackets', () => {
    let inline = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
      office.{ address.* }
    }`
    let absolutePaths = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
      office.address.city,
      office.address.street,
      office.address.country,
    }`
    let expected = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
      EmployeeNoUnmanaged.office_address_city,
      EmployeeNoUnmanaged.office_address_street,
      EmployeeNoUnmanaged.office_address_country_code,
    }`

    expect(cqn4sql(inline, model)).to.eql(cqn4sql(absolutePaths)).to.eql(expected)
  })

  it('smart wildcard - assoc overwrite after *', () => {
    // office.address.city replaces office.floor
    let inline = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
      office.{ *, furniture as building, address.city as floor, building.id as room }
    }`
    let absolutePaths = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
      office.address.city as office_floor,
      office.building.id as office_room,
      office.furniture as office_building,
      office.address,
      office.furniture
    }`
    let expected = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
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
    const inlineRes = cqn4sql(inline, model)
    expect(inlineRes).to.eql(cqn4sql(absolutePaths)).to.eql(expected)
  })

  it('smart wildcard - structure overwritten by assoc before *', () => {
    // intermediate structures are overwritten
    let inline = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
      office.{ building as furniture, * }
    }`
    let absolutePaths = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
      office.building as office_furniture,
      office.floor,
      office.room,
      office.building,
      office.address
    }`
    let expected = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
     EmployeeNoUnmanaged.office_building_id as office_furniture_id,
     EmployeeNoUnmanaged.office_floor,
     EmployeeNoUnmanaged.office_room,
     EmployeeNoUnmanaged.office_building_id,
     EmployeeNoUnmanaged.office_address_city,
     EmployeeNoUnmanaged.office_address_street,
     EmployeeNoUnmanaged.office_address_country_code
    }`
    const inlineRes = cqn4sql(inline, model)
    expect(inlineRes).to.eql(cqn4sql(absolutePaths)).to.eql(expected)
  })
  it('smart wildcard - structure overwritten by join relevant assoc before *', () => {
    // intermediate structures are overwritten
    let inline = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
      office.{ building[name='mega tower'].name as furniture, * }
    }`
    let absolutePaths = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
      office.building[name='mega tower'].name as office_furniture,
      office.floor,
      office.room,
      office.building,
      office.address
    }`
    let expected = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged
      left join Building as building on building.id = EmployeeNoUnmanaged.office_building_id and building.name = 'mega tower'
    {
     building.name as office_furniture,
     EmployeeNoUnmanaged.office_floor,
     EmployeeNoUnmanaged.office_room,
     EmployeeNoUnmanaged.office_building_id,
     EmployeeNoUnmanaged.office_address_city,
     EmployeeNoUnmanaged.office_address_street,
     EmployeeNoUnmanaged.office_address_country_code
    }`
    const inlineRes = cqn4sql(inline, model)
    const absoluteRes = cqn4sql(absolutePaths)
    expect(inlineRes).to.eql(absoluteRes).to.eql(expected)
  })
  it('wildcard - no overwrite but additional cols', () => {
    // intermediate structures are overwritten
    let inline = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
      office.{ *, 'foo' as last }
    }`
    let absolutePaths = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
      office.floor,
      office.room,
      office.building,
      office.address,
      office.furniture,
      'foo' as office_last
    }`
    let expected = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged
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
    const inlineRes = cqn4sql(inline, model)
    const absoluteRes = cqn4sql(absolutePaths)
    expect(inlineRes).to.eql(absoluteRes).to.eql(expected)
  })
  it('assigning alias within inline only influences name of element, prefix still appended', () => {
    // intermediate structures are overwritten
    let inline = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
      office.{ floor as x }
    }`
    let expected = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
     EmployeeNoUnmanaged.office_floor as office_x,
    }`
    const inlineRes = cqn4sql(inline, model)
    expect(inlineRes).to.eql(expected)
  })
  it('smart wildcard - structured overwrite before *', () => {
    // intermediate structures are overwritten
    let inline = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
      office.{ 'first' as furniture, 'second' as building, * }
    }`
    let absolutePaths = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
     'first' as office_furniture,
     'second' as office_building,
      office.floor,
      office.room,
      office.address
    }`
    let expected = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
     'first' as office_furniture,
     'second' as office_building,
     EmployeeNoUnmanaged.office_floor,
     EmployeeNoUnmanaged.office_room,
     EmployeeNoUnmanaged.office_address_city,
     EmployeeNoUnmanaged.office_address_street,
     EmployeeNoUnmanaged.office_address_country_code,
    }`
    const inlineRes = cqn4sql(inline, model)
    expect(inlineRes).to.eql(cqn4sql(absolutePaths)).to.eql(expected)
  })
  it('smart wildcard - structured overwrite after *', () => {
    // intermediate structures are overwritten
    let inline = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
      office.{*, 'third' as building, 'fourth' as address }
    }`
    let absolutePaths = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
      office.floor,
      office.room,
      'third' as office_building,
      'fourth' as office_address,
      office.furniture
    }`
    let expected = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
     EmployeeNoUnmanaged.office_floor,
     EmployeeNoUnmanaged.office_room,
     'third' as office_building,
     'fourth' as office_address,
     EmployeeNoUnmanaged.office_furniture_chairs,
     EmployeeNoUnmanaged.office_furniture_desks
    }`
    const inlineRes = cqn4sql(inline, model)
    expect(inlineRes).to.eql(cqn4sql(absolutePaths)).to.eql(expected)
  })

  it('wildcard expansion - exclude association', () => {
    // intermediate structures are overwritten
    let inline = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged  {
      office.{*} excluding { building, address }
    }`
    let absolutePaths = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged  {
      office.floor,
      office.room,
      office.furniture
    }`
    let expected = cds.ql`select from EmployeeNoUnmanaged as EmployeeNoUnmanaged {
     EmployeeNoUnmanaged.office_floor,
     EmployeeNoUnmanaged.office_room,
     EmployeeNoUnmanaged.office_furniture_chairs,
     EmployeeNoUnmanaged.office_furniture_desks
    }`
    const inlineRes = cqn4sql(inline, model)
    expect(inlineRes).to.eql(cqn4sql(absolutePaths)).to.eql(expected)
  })

  it('wildcard expansion sql style on table alias', () => {
    let inline = cds.ql`select from EmployeeNoUnmanaged as E {
      E.*
    }`
    let inlineWithBrackets = cds.ql`select from EmployeeNoUnmanaged as E {
      E.{*}
    }`
    let regularWildcard = cds.ql`select from EmployeeNoUnmanaged as E {
      *
    }`
    let expected = cds.ql`select from EmployeeNoUnmanaged as E {
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
    const inlineRes = cqn4sql(inline, model)
    expect(inlineRes).to.eql(cqn4sql(inlineWithBrackets)).to.eql(cqn4sql(regularWildcard)).to.eql(expected)
  })
  it('wildcard expansion sql style on table alias - exclude stuff', () => {
    let inlineWithBrackets = cds.ql`select from EmployeeNoUnmanaged as E {
      E.{*} excluding { office }
    }`
    let regularWildcard = cds.ql`select from EmployeeNoUnmanaged as E {
      *
    } excluding { office }`
    let expected = cds.ql`select from EmployeeNoUnmanaged as E {
     E.id,
     E.name,
     E.job,
     E.department_id

    }`
    const inlineRes = cqn4sql(inlineWithBrackets)
    const regularWildcardRes = cqn4sql(regularWildcard)
    expect(inlineRes)
      .to.eql(expected)
      .to.eql(JSON.parse(JSON.stringify(regularWildcardRes))) // prototype is different
  })
})
