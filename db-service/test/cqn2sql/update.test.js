'use strict'
const cds = require('@sap/cds/lib')
const _cqn2sql = require('../../lib/cqn2sql')
function cqn2sql(q, m = cds.model) {
  return _cqn2sql(q, m)
} 

beforeAll(async () => {
  cds.model = await cds.load(__dirname + '/testModel').then(cds.linked)
})
describe('.update', () => {
  test('test with entity of type string', () => {
    const cqnUpdate = {
      UPDATE: {
        entity: { ref: ['Foo2'] },
        with: { ID: { val: 1 }, name: { val: "'asd'" }, a: { val: 2 } },
      },
    }

    const { sql, values } = cqn2sql(cqnUpdate)
    expect({ sql, values }).toMatchSnapshot()
  })

  test('test with entity of type string and where clause', () => {
    const cqnUpdate = {
      UPDATE: {
        entity: { ref: ['Foo2'] },
        with: { ID: { val: 1 }, name: { val: "'asd'" }, a: { val: 2 } },
        where: [{ ref: ['a'] }, '<', { val: 9 }],
      },
    }
    const { sql, values } = cqn2sql(cqnUpdate)
    expect({ sql, values }).toMatchSnapshot()
  })

  test('test with setting a value to null', () => {
    const cqnUpdate = {
      UPDATE: {
        entity: { ref: ['Foo2'] },
        with: { ID: { val: 1 }, name: { val: null }, a: { val: 2 } },
        where: [{ ref: ['a'] }, '<', { val: 9 }],
      },
    }

    const { sql, values } = cqn2sql(cqnUpdate)
    expect({ sql, values }).toMatchSnapshot()
  })

  test('test with entity and values with operators', () => {
    const cqnUpdate = {
      UPDATE: {
        entity: 'Foo2',
        with: {
          ID: { val: 42 },
          name: { val: "'asd'" },
          a: { xpr: [{ ref: ['a'] }, '-', { val: 1 }] },
          count: { func: 'count', args: ['*'] },
        },
      },
    }
    const { sql, values } = cqn2sql(cqnUpdate)
    expect({ sql, values }).toMatchSnapshot()
  })

  //REVISIT aliasing with columns doesn't work
  test('data alone still works', () => {
    const cqnUpdate = {
      UPDATE: {
        entity: { ref: ['Foo2'] },
        data: {
          ID: 1,
          name: undefined,
          a: null,
        },
      },
    }
    const { sql, values } = cqn2sql(cqnUpdate)
    expect({ sql, values }).toMatchSnapshot()
  })

  test('virtual and non-existing filtered out from data', () => {
    const cqnUpdate = {
      UPDATE: {
        entity: { ref: ['Foo2'] },
        data: {
          ID: 1,
          something: 'bla',
          foo: null,
        },
      },
    }
    const { sql, values } = cqn2sql(cqnUpdate)
    expect({ sql, values }).toMatchSnapshot()
  })

  test('set enhances data', () => {
    const cqnUpdate = {
      UPDATE: {
        entity: { ref: ['Foo2'] },
        with: { ID: { val: 1 }, name: { val: "'asd'" } },
        data: { a: 2 },
      },
    }

    const { sql, values } = cqn2sql(cqnUpdate)
    expect({ sql, values }).toMatchSnapshot()
  })

  test('virtual and non-existing fields filtered out from with', () => {
    const cqnUpdate = {
      UPDATE: {
        entity: { ref: ['Foo2'] },
        with: { ID: { val: 1 }, name: { val: "'asd'" }, something: { val: 'bla' } /* foo: {ref: 'Foo'} */ },
      },
    }

    const { sql, values } = cqn2sql(cqnUpdate)
    expect({ sql, values }).toMatchSnapshot()
  })

  test('set overwrites data', () => {
    const cqnUpdate = {
      UPDATE: {
        entity: 'Foo2',
        with: { ID: { val: 1 }, name: { val: "'asd'" }, a: { val: 6 } },
        data: { a: 2 },
      },
    }

    const { sql, values } = cqn2sql(cqnUpdate)
    expect({ sql, values }).toMatchSnapshot()
  })

  // TODO change to native sql -> not really useful to test here
  test.skip('test with subselect - sflight example', () => {
    const qlUpdate = UPDATE(`Travel`).with({
      TotalPrice: CXL`coalesce (BookingFee, 0) + ${SELECT`coalesce (sum (FlightPrice + ${SELECT`coalesce (sum (Price),0)`.from(
        `BookingSupplement`,
      ).where`to_Booking_BookingUUID = BookingUUID`}),0)`.from(`Booking`).where`to_Travel_TravelUUID = TravelUUID`}`,
    })
    const { sql, values } = cqn2sql(qlUpdate)
    expect({ sql, values }).toMatchSnapshot()
  })
})
