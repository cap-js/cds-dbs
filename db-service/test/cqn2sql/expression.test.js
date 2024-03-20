'use strict'
const cds = require('@sap/cds/lib')
const _cqn2sql = require('../../lib/cqn2sql')
function cqn2sql(q, m = cds.model) {
  return _cqn2sql(q, m)
} 

beforeAll(async () => {
  cds.model = await cds.load(__dirname + '/testModel').then(cds.linked)
})

describe('expressions', () => {
  // xtest('parameterized numbers', () => {
  //   const opts = { parameterized_numbers: true }
  //   const xpr = [{ ref: ['x'] }, '<', { val: 9 }]
  //   const expected = { sql: 'x < ?', values: [9] }
  //   const result = new ExpressionBuilder(xpr, opts).build()
  //   const { sql, entries } = cqn2sql(cqnInsert)
  //   expect({ sql, entries }).toMatchSnapshot()
  //   expect(result).toEqual(expected)
  // })

  xtest('ref, String operator and value', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [{ ref: ['x'] }, new String('<'), { val: 9 }],
      },
    }
    const { sql, values } = cqn2sql(cqn)
    expect({ sql, values }).toMatchSnapshot()
  })

  test('ref = null', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [{ ref: ['x'] }, '=', { val: null }],
      },
    }
    const { sql } = cqn2sql(cqn)
    expect(sql).toMatch(/SELECT Foo.ID,Foo.a,Foo.b,Foo.c,Foo.x FROM Foo as Foo WHERE Foo.x IS NULL/i)
  })

  // We should never have supported that!
  test('null = ref', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [{ val: null }, '=', { ref: ['x'] }],
      },
    }
    const { sql } = cqn2sql(cqn)
    expect(sql).toMatch(/SELECT Foo.ID,Foo.a,Foo.b,Foo.c,Foo.x FROM Foo as Foo WHERE null = Foo.x/i)
  })

  // We should never have supported that!
  test('null = null', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [{ val: null }, '=', { val: null }],
      },
    }
    const { sql } = cqn2sql(cqn)
    expect(sql).toMatch(/SELECT Foo.ID,Foo.a,Foo.b,Foo.c,Foo.x FROM Foo as Foo WHERE NULL IS NULL/i)
  })

  test('ref != null', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [{ ref: ['x'] }, '!=', { val: null }],
      },
    }
    const { sql } = cqn2sql(cqn)
    expect(sql).toMatch(/SELECT Foo.ID,Foo.a,Foo.b,Foo.c,Foo.x FROM Foo as Foo WHERE Foo.x IS NOT NULL/i)
  })

  test('val != val', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [{ val: 5 }, '!=', { val: 6 }],
      },
    }
    const { sql } = cqn2sql(cqn)
    expect(sql).toMatch(/SELECT Foo.ID,Foo.a,Foo.b,Foo.c,Foo.x FROM Foo as Foo WHERE 5 <> 6/i)
  })

  test('ref != ref', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [{ ref: ['x'] }, '!=', { ref: ['a'] }],
      },
    }
    const { sql } = cqn2sql(cqn)
    expect(sql).toMatch(/SELECT Foo.ID,Foo.a,Foo.b,Foo.c,Foo.x FROM Foo as Foo WHERE Foo.x is distinct from Foo.a/i)
    // Note: test before was that, which is wrong:
    // sql: 'SELECT Foo.ID,Foo.a,Foo.b,Foo.c,Foo.x FROM Foo as Foo WHERE Foo.x != Foo.a',
  })

  // We should never have supported that!
  test('null != ref', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [{ val: null }, '!=', { ref: ['x'] }],
      },
    }
    const { sql } = cqn2sql(cqn)
    expect(sql).toMatch(/SELECT Foo.ID,Foo.a,Foo.b,Foo.c,Foo.x FROM Foo as Foo WHERE null is distinct from Foo.x/i)
  })

  test('ref != 5', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [{ ref: ['x'] }, '!=', { val: 5 }],
      },
    }
    const { sql } = cqn2sql(cqn)
    expect(sql).toMatch(/SELECT Foo.ID,Foo.a,Foo.b,Foo.c,Foo.x FROM Foo as Foo WHERE Foo.x is distinct from 5/i)
  })

  test('ref <> 5', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [{ ref: ['x'] }, '<>', { val: 5 }],
      },
    }
    const { sql } = cqn2sql(cqn)
    expect(sql).toMatch(/SELECT Foo.ID,Foo.a,Foo.b,Foo.c,Foo.x FROM Foo as Foo WHERE Foo.x <> 5/i)
  })

  test('ref != 5 and more', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [{ ref: ['x'] }, '=', { val: 7 }, 'or', { ref: ['x'] }, '!=', { val: 5 }],
      },
    }
    const { sql } = cqn2sql(cqn)
    expect(sql).toMatch(
      /SELECT Foo.ID,Foo.a,Foo.b,Foo.c,Foo.x FROM Foo as Foo WHERE Foo.x = 7 or Foo.x is distinct from 5/i,
    )
  })

  // We don't have to support that
  test('5 != ref', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [{ val: 5 }, '!=', { ref: ['x'] }],
      },
    }
    const { sql, values } = cqn2sql(cqn)
    expect({ sql, values }).toEqual({
      sql: 'SELECT Foo.ID,Foo.a,Foo.b,Foo.c,Foo.x FROM Foo as Foo WHERE 5 is distinct from Foo.x',
      values: [],
    })
  })

  test('nested 5 != ref', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [
          { xpr: [{ ref: ['x'] }, '!=', { val: 5 }] },
          'or',
          { xpr: [{ ref: ['x'] }, '=', { val: null }] },
          // We should never have supported that!
          // 'or',
          // { xpr: [{ val: null }, '=', { ref: ['x'] }] }
        ],
      },
    }
    const { sql } = cqn2sql(cqn)
    expect(sql).toEqual(
      'SELECT Foo.ID,Foo.a,Foo.b,Foo.c,Foo.x FROM Foo as Foo WHERE (Foo.x is distinct from 5) or (Foo.x is NULL)',
    )
  })

  test('ref is like pattern', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [{ ref: ['x'] }, 'like', { val: '%123' }],
      },
    }
    const { sql, values } = cqn2sql(cqn)
    expect({ sql, values }).toMatchSnapshot()
  })

  test('ref is regular expression', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [{ ref: ['x'] }, 'between', { val: 1 }, 'and', { val: 20 }],
      },
    }
    const { sql, values } = cqn2sql(cqn)
    expect({ sql, values }).toMatchSnapshot()
  })

  test('ref is between two range', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [{ ref: ['x'] }, 'regexp', { val: '/\\d/' }],
      },
    }
    const { sql, values } = cqn2sql(cqn)
    expect({ sql, values }).toMatchSnapshot()
  })

  xtest('ref is placeholder with param', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [{ ref: ['x'] }, '>', { param: true, ref: ['abc'] }],
      },
    }
    const { sql, values } = cqn2sql(cqn)
    expect({ sql, values }).toMatchSnapshot()
    /*const expected = {
        sql: 'x > ?',
        values: ['abc']
      }*/
  })

  xtest('ref is placeholder without param', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [{ ref: ['x'] }, '>', { param: true, ref: ['?'] }],
      },
    }
    const { sql, values } = cqn2sql(cqn)
    expect({ sql, values }).toMatchSnapshot()
    /*const expected = {
        sql: 'x > ?',
        values: []
      }*/
  })

  test('ref is in list of sub select', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [
          { ref: ['x'] },
          'IN',
          {
            SELECT: {
              from: { ref: ['Foo2'] },
              columns: [{ ref: ['name'] }],
            },
          },
        ],
      },
    }
    const { sql, values } = cqn2sql(cqn)
    expect({ sql, values }).toMatchSnapshot()
  })

  test('ref list with one ref is in list of sub select', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [
          { list: [{ ref: ['x'] }] },
          'IN',
          {
            SELECT: {
              from: { ref: ['Foo2'] },
              columns: [{ ref: ['name'] }],
            },
          },
        ],
      },
    }
    const { sql, values } = cqn2sql(cqn)
    expect({ sql, values }).toMatchSnapshot()
  })

  test('ref list with multiple refs is in list of sub select', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [
          { list: [{ ref: ['x'] }, { ref: ['b'] }] },
          'IN',
          {
            SELECT: {
              from: { ref: ['Foo2'] },
              columns: [{ ref: ['ID'] }, { ref: ['name'] }],
            },
          },
        ],
      },
    }
    const { sql, values } = cqn2sql(cqn)
    expect({ sql, values }).toMatchSnapshot()
  })

  test('with complex xpr', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [{ xpr: [{ ref: ['x'] }, '<', { val: 9 }] }, 'AND', { xpr: [{ ref: ['x'] }, '>', { val: 1 }] }],
      },
    }
    const { sql, values } = cqn2sql(cqn)
    expect({ sql, values }).toMatchSnapshot()
  })

  test('with long xpr', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [{ ref: ['x'] }, '<', { val: 9 }, 'AND', { ref: ['x'] }, '>', { val: 1 }],
      },
    }
    const { sql, values } = cqn2sql(cqn)
    expect({ sql, values }).toMatchSnapshot()
  })

  test('with exists', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [
          'exists',
          {
            SELECT: {
              from: { ref: ['Foo2'] },
              columns: [{ ref: ['name'] }],
            },
          },
          'or not exists',
          {
            SELECT: {
              from: { ref: ['Foo2'] },
              columns: [{ ref: ['name'] }],
            },
          },
        ],
      },
    }
    const { sql, values } = cqn2sql(cqn)
    expect({ sql, values }).toMatchSnapshot()
  })

  test('window function ROW_NUMBER over partition', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [
          { func: 'ROW_NUMBER', args: [{ val: 1 }] },
          'OVER',
          { xpr: ['PARTITION BY', { ref: ['b'] }, 'ORDER BY', { ref: ['x'] }, 'desc'] },
        ],
      },
    }
    const { sql } = cqn2sql(cqn)
    expect(sql).toEqual(
      'SELECT Foo.ID,Foo.a,Foo.b,Foo.c,Foo.x FROM Foo as Foo WHERE ROW_NUMBER(1) OVER (PARTITION BY Foo.b ORDER BY Foo.x desc)',
    )
  })
})
