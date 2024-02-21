const cds = require('@sap/cds/lib')
const _cqn2sql = require('../../lib/cqn2sql')
function cqn2sql(q, m = cds.model) {
  return _cqn2sql(q, m)
} 

beforeAll(async () => {
  cds.model = await cds.load(__dirname + '/testModel').then(cds.linked)
})
describe('function', () => {
  test('contains complex', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [
          {
            func: 'contains',
            args: [{ list: [{ ref: ['a'] }, { ref: ['b'] }] }, { val: '5' }],
          },
        ],
      },
    }
    const { sql, values } = cqn2sql(cqn)
    expect({ sql, values }).toMatchSnapshot()
    // Hana syntax expected -> "( ID LIKE ( '%' || ? || '%' ) ESCAPE '^' OR AGE LIKE ( '%' || ? || '%' ) ESCAPE '^' )"
    // result -> instr((Foo.a,Foo.b),?)"
  })

  test('wrap xpr in concat functions in parentheses', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        columns: [
          {
            func: 'concat',
            args: [
              { val: 2023 },
              {
                xpr: [{ val: 8 }, '*', { val: 2 }, '-', { val: 0 }],
              },
            ],
            as: 'something',
          },
        ],
      },
    }
    const { sql, values } = cqn2sql(cqn)
    expect({ sql, values }).toMatchSnapshot()
  })

  xtest('contains complex', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [
          {
            func: 'contains',
            args: [{ list: [{ ref: ['a'] }] }, { val: 'abc' }, 'and', { val: 'bcd' }, 'or', { val: 'efg' }],
          },
        ],
      },
    }
    const { sql, values } = cqn2sql(cqn)
    expect({ sql, values }).toMatchSnapshot()
    // Hana syntax expected ->"( a LIKE ( '%' || ? || '%' ) ESCAPE '^' ) and ( a LIKE ( '%' || ? || '%' ) ESCAPE '^' ) or ( a LIKE ( '%' || ? || '%' ) ESCAPE '^' )"
    // requires adjustment of instr to support logical operators
  })

  xtest('contains complex new notation', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [
          {
            func: 'contains',
            args: [
              {
                list: [{ ref: ['ID'] }, { ref: ['x'] }],
              },
              { val: '5' },
              'and',
              'not',
              { val: '3' },
            ],
          },
        ],
      },
    }
    const { sql, values } = cqn2sql(cqn)
    expect({ sql, values }).toMatchSnapshot()
    // "( ID LIKE ( '%' || ? || '%' ) ESCAPE '^' OR x LIKE ( '%' || ? || '%' ) ESCAPE '^' ) and not ( ID LIKE ( '%' || ? || '%' ) ESCAPE '^' OR x LIKE ( '%' || ? || '%' ) ESCAPE '^' )"
    // result -> Unsupported expr: and
  })

  test('not contains', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [
          'not',
          {
            func: 'contains',
            args: [{ list: [{ ref: ['b'] }] }, { val: '5' }],
          },
        ],
      },
    }
    const { sql, values } = cqn2sql(cqn)
    expect({ sql, values }).toEqual({
      sql: `SELECT Foo.ID,Foo.a,Foo.b,Foo.c,Foo.x FROM Foo as Foo WHERE not ifnull(instr((Foo.b),?),0)`,
      values: ['5'],
    })
  })

  xtest('not contains complex', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [
          'not',
          {
            func: 'contains',
            args: [{ list: [{ ref: ['ID'] }, { ref: ['a'] }] }, { val: '5' }],
          },
        ],
      },
    }
    const { sql, values } = cqn2sql(cqn)
    expect({ sql, values }).toEqual({
      sql: 'SELECT Foo.ID,Foo.a,Foo.b,Foo.c,Foo.x FROM Foo as Foo WHERE not (instr((Foo.ID),?) and instr((Foo.a),?))',
      values: ['5', '5'],
    })
  })

  xtest('contains values with wildcards/escape characters', () => {
    const getExprWithVal = val => {
      return {
        SELECT: {
          from: { ref: ['Foo'] },
          where: [
            'not',
            {
              func: 'contains',
              args: [{ list: [{ ref: ['a'] }] }, { val }],
            },
          ],
        },
      }
    }
    // Input values should be escaped with ^ (on HANA)
    const { values } = cqn2sql(getExprWithVal('Te%st'))
    expect({ values }).toMatchSnapshot()

    const { values1 } = cqn2sql(getExprWithVal('Te_st'))
    expect({ values1 }).toMatchSnapshot()

    const { values2 } = cqn2sql(getExprWithVal('Te^st'))
    expect({ values2 }).toMatchSnapshot()

    const { values3 } = cqn2sql(getExprWithVal('Te^^st'))
    expect({ values3 }).toMatchSnapshot()

    const { values4 } = cqn2sql(getExprWithVal('Te^^st'))
    expect({ values4 }).toMatchSnapshot()

    // expected 'Te^%st' , result 'Te%st'
  })

  xtest('contains will not modify the original object', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [
          {
            func: 'contains',
            args: [{ list: [{ ref: ['a'] }] }, { val: 'Te%st' }],
          },
        ],
      },
    }
    const { values } = cqn2sql(cqn)
    expect({ values }).toMatchSnapshot()

    //expect(custom1._outputObj.values).toEqual(['Te^%st'])
    //expect(cqn.SELECT.where[0].args[1].val).toEqual('Te%st')
  })

  test('fn with .xpr as argument', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [
          {
            func: 'round',
            args: [{ xpr: [{ ref: ['x'] }, '-', { val: 100 }] }, { val: 3 }],
          },
        ],
      },
    }
    const { sql, values } = cqn2sql(cqn)
    expect({ sql, values }).toMatchSnapshot()
  })

  test('without args', () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Foo'] },
        where: [{ func: 'current_date' }],
      },
    }
    const { sql } = cqn2sql(cqn)
    expect(sql).toEqual('SELECT Foo.ID,Foo.a,Foo.b,Foo.c,Foo.x FROM Foo as Foo WHERE current_date')
  })
})
