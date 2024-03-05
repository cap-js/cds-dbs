'use strict'
const cds = require('@sap/cds/lib')
const _cqn2sql = require('../../lib/cqn2sql')
function cqn2sql(q, m = cds.model) {
  
  return _cqn2sql(q, m)
} 
const cqn = require('./cqn.js')

// const getExpected = (sql, values) => {
//   return {
//     sql: sql,
//     values: values || []
//   }
// }

describe('cqn2sql', () => {
  beforeAll(async () => {
    cds.model = await cds.load(__dirname + '/testModel').then(cds.linked)
  })
  describe('selection of columns of one table', () => {
    test('with select with from ref and elements = undefined', () => {
      const { sql } = cqn2sql(cqn.select)
      expect(sql).toMatchSnapshot()
    })

    // empty columns will be ignored
    test('with select with from ref and elements as empty array', () => {
      const cqnSelect = {
        SELECT: Object.assign({}, cqn.select.SELECT, { columns: [] }),
      }
      const { sql } = cqn2sql(cqnSelect)
      expect(sql).toMatchSnapshot()
    })

    test('with select specific elements with from ref', () => {
      const { sql } = cqn2sql(cqn.selectWithColumns)
      expect(sql).toMatchSnapshot()
    })

    // empty orderBy will be ignored
    test('with select with empty orderBy and specific elements with from type string', () => {
      const { sql } = cqn2sql(cqn.selectWithColumnsEmptyOrderBy)
      expect(sql).toMatchSnapshot()
    })

    test('with select with asterisk in columns', () => {
      const { sql } = cqn2sql(cqn.selectWithColumnsWithAsterisk)
      expect(sql).toMatchSnapshot()
    })

    test('select distinct', () => {
      const { sql } = cqn2sql(cqn.selectDistinct)
      expect(sql).toMatchSnapshot()
    })

    test('with select that has (faked) reflection model', () => {
      const { sql } = cqn2sql(cqn.selectWithCSN)
      expect(sql).toMatchSnapshot()
    })

    test('with select from non existent entity with star wildcard', () => {
      expect(() => {
        let q = cqn.selectNonExistent
        // Skip cqn4sql as infer requires the entity to exist
        const render = q => new _cqn2sql.class().render(q)
        const { sql } = render(q)
        expect(sql).toMatchSnapshot()
        q = cds.ql.clone(q)
        q.SELECT.expand = 'root'
        render(q) // throws
      }).toThrowError('Query was not inferred and includes expand. For which the metadata is missing.')
    })

    test('with select from non existent entity with star wildcard (extended)', () => {
      expect(() => {
        const customCqn2sql = class extends _cqn2sql.class {
          SELECT_columns({ SELECT }) {
            return SELECT.columns.map(x => `${this.quote(this.column_name(x))}`)
          }
        }
        const q = cqn.selectNonExistent
        // Skip cqn4sql as infer requires the entity to exist
        const render = q => new customCqn2sql().render(q)
        render(q) // throws
      }).toThrowError(
        `Query was not inferred and includes '*' in the columns. For which there is no column name available.`,
      )
    })
  })

  describe('WHERE', () => {
    test('entries where one column holds entries smaller than 9', () => {
      const { sql } = cqn2sql(cqn.selectWhereSmaller)
      expect(sql).toMatchSnapshot()
    })

    test('entries where with place holder', () => {
      const { sql, values } = cqn2sql(cqn.selectWhereWithOnePlaceholderCqn)
      expect({ sql, values }).toMatchSnapshot()
    })

    test('entries where with int reference and param true', () => {
      const { sql, values } = cqn2sql(cqn.selectWhereWithRefIntParamTrueCqn)
      expect({ sql, values }).toMatchSnapshot()
    })

    test('where with partial cqn', () => {
      const { sql } = cqn2sql(cqn.selectWhereCqn)
      expect(sql).toMatchSnapshot()
    })

    test('where with two partial cqn', () => {
      const { sql } = cqn2sql(cqn.selectWhereTwoCqn)
      expect(sql).toMatchSnapshot()
    })

    test('entries where one column holds entries which are in list', () => {
      const { sql } = cqn2sql(cqn.selectWhereList)
      expect(sql).toMatchSnapshot()
    })

    test('select with a nested select in where', () => {
      const { sql } = cqn2sql(cqn.selectWhereSelect)
      expect(sql).toMatchSnapshot()
    })

    test('select with a nested select in a complex where', () => {
      const { sql } = cqn2sql(cqn.selectComplexWhere)
      expect(sql).toMatchSnapshot()
    })

    test('with select with exist in where condition', () => {
      const { sql } = cqn2sql(cqn.selectWhereExists)
      expect(sql).toMatchSnapshot()
    })

    test('with list of values', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Foo'] },
          where: [
            { list: [{ ref: ['a'] }, { ref: ['b'] }, { val: 1 }] },
            '=',
            { list: [{ ref: ['c'] }, { val: 'd' }, { ref: ['x'] }] },
          ],
        },
      }
      const { sql, values } = cqn2sql(cqn)
      expect({ sql, values }).toMatchSnapshot()
    })

    test('with contains with one column in where clause', () => {
      // const expected = getExpected("SELECT Foo.ID,Foo.a,Foo.b,Foo.c,Foo.x FROM Foo AS Foo FROM T WHERE ( b LIKE ( '%' || ? || '%' ) ESCAPE '^' )", ['5'])
      const { sql, values } = cqn2sql(cqn.selectContainsOneColumn)
      expect({ sql, values }).toMatchSnapshot()
    })

    test('EXISTS with nested EXISTS', () => {
      const { sql } = cqn2sql(cqn.selectWhereNestedExists)
      expect(sql).toMatchSnapshot()
    })

    test('with function without alias', () => {
      const toThrow = () => {
        return cqn2sql(cqn.selectFuncitonWithoutAlias)
      }
      expect(toThrow).toThrowError('Expecting expression to have an alias name')
    })

    test('with contains with multiple values', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Foo'] },
          where: [
            { ref: ['a'] },
            '=',
            { val: 0 },
            'and',
            {
              func: 'contains',
              args: [{ list: [{ ref: ['a'] }] }, { val: 'z' }, 'or', { val: 'zz' }],
            },
          ],
        },
      }
      const toThrow = () => {
        return cqn2sql(cqn)
      }
      expect(toThrow).toThrowError('Unsupported expr: or')
    })

    test('with contains with multiple arguments', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Foo'] },
          where: [
            { ref: ['a'] },
            '=',
            { val: 0 },
            'and',
            {
              func: 'contains',
              args: [{ list: [{ ref: ['a'] }, { ref: ['b'] }, { ref: ['c'] }, { ref: ['x'] }] }, { val: 'z' }],
            },
          ],
        },
      }
      const { sql } = cqn2sql(cqn)
      expect(sql).toMatchSnapshot()
    })
  })
  describe('HAVING clauses', () => {
    test('with select specific elements with from type string with having clause', () => {
      const { sql } = cqn2sql(cqn.selectHaving)
      expect(sql).toMatchSnapshot()
    })
  })

  describe('complex combinations', () => {
    test('WHERE, GROUP BY, HAVING, ORDER BY, LIMIT, OFFSET', () => {
      const { sql } = cqn2sql(cqn.selectAggregationLimitOrder)
      expect(sql).toMatchSnapshot()
    })

    test('AS, sub query', () => {
      const { sql } = cqn2sql(cqn.selectSubSelect)
      expect(sql).toMatchSnapshot()
    })

    test('Exists in object mode in complex where', () => {
      const { sql, values } = cqn2sql(cqn.selectComplexWhereWithExists)
      expect({ sql, values }).toMatchSnapshot()
    })
  })

  describe('GROUP BY', () => {
    test('GROUP BY two columns', () => {
      const { sql } = cqn2sql(cqn.groupBy)
      expect(sql).toMatchSnapshot()
    })
  })

  describe('ORDER BY', () => {
    test('ORDER BY alias', () => {
      const { sql } = cqn2sql(cqn.orderByWithAlias)
      expect(sql).toMatchSnapshot()
    })
  })

  describe('ONE', () => {
    test('one results in limit 1', () => {
      const { sql } = cqn2sql(cqn.one)
      expect(sql).toMatchSnapshot()
    })

    test('one with additional limit with offset', () => {
      // Original DB layer expectation is to mix limit and one
      // One has priority over limit.rows, but limit.offset is still applied
      const { sql } = cqn2sql(cqn.oneWithLimit)
      expect(sql).toEqual('SELECT Foo.a,Foo.b,Foo.c FROM Foo as Foo LIMIT 1 OFFSET 5')
    })
  })

  describe('LIMIT', () => {
    test('with limit without offset', () => {
      const { sql } = cqn2sql(cqn.limit)
      expect(sql).toMatchSnapshot()
    })

    test('with limit and offset', () => {
      const { sql } = cqn2sql(cqn.limitOffset)
      expect(sql).toMatchSnapshot()
    })

    test('limit without rows throws error', () => {
      const toThrow = () => {
        return cqn2sql({ SELECT: { from: { ref: ['Foo'] }, limit: { offset: { val: 5 } } } })
      }
      expect(toThrow).toThrowError('Rows parameter is missing in SELECT.limit(rows, offset)')
    })
  })

  describe('aggregation functions', () => {
    test('with select with same functions without alias in elements', () => {
      const toThrow = () => {
        return cqn2sql(cqn.selectWithSameFunctionsWithoutAlias)
      }
      expect(toThrow).toThrowError('Duplicate definition of element “count”')
    })

    test('with select with different functions without alias in elements', () => {
      const { sql } = cqn2sql(cqn.selectWithFunctionsWithoutAlias)
      expect(sql).toMatchSnapshot()
    })

    test('with select with functions in elements new notation', () => {
      const { sql } = cqn2sql(cqn.selectWithAggregationNew)
      expect(sql).toMatchSnapshot()
    })

    test('with select with count(1)', () => {
      const { sql } = cqn2sql(cqn.selectWithCountOne)
      expect(sql).toMatchSnapshot()
    })

    test('with select with functions in where clause new notation', () => {
      const { sql } = cqn2sql(cqn.selectWhereAggregationNew)
      expect(sql).toMatchSnapshot()
    })
  })

  describe('functions new notation', () => {
    test('function with xpr', () => {
      const { sql, values } = cqn2sql({
        SELECT: {
          from: { ref: ['Foo'] },
          columns: [
            {
              func: 'replace_regexpr',
              args: [
                {
                  xpr: [{ val: 'A' }, 'flag', { val: 'i' }, 'in', { val: 'ABC-abc-AAA-aaa' }, 'with', { val: 'B' }],
                },
              ],
              as: 'replaced',
            },
          ],
        },
      })
      expect(sql).toMatchSnapshot()
      expect(values).toMatchSnapshot()
    })

    test('function with multiple xpr', () => {
      const { sql, values } = cqn2sql({
        SELECT: {
          from: { ref: ['Foo'] },
          columns: [
            {
              func: 'replace_regexpr',
              args: [
                { ref: ['a'] },
                { val: 5 },
                {
                  xpr: [{ val: 'A' }, 'flag', { val: 'i' }, 'in', { val: 'ABC-abc-AAA-aaa' }, 'with', { val: 'B' }],
                },
              ],
              as: 'replaced',
            },
          ],
        },
      })
      expect(sql).toMatchSnapshot()
      expect(values).toMatchSnapshot()
    })

    test('in orderby with 1 arg new notation', () => {
      const { sql } = cqn2sql({
        SELECT: {
          from: { ref: ['Foo'] },
          orderBy: [{ func: 'lower', args: [{ ref: ['c'] }], sort: 'desc' }],
        },
      })
      expect(sql).toMatchSnapshot()
    })

    test('in filter with 1 arg new notation', () => {
      const { sql, values } = cqn2sql({
        SELECT: {
          from: { ref: ['Foo'] },
          where: [{ func: 'lower', args: [{ ref: ['c'] }] }, '=', { val: 'name' }],
        },
      })
      expect({ sql, values }).toMatchSnapshot()
    })

    test('in filter with asterisk as arg new notation', () => {
      const { sql } = cqn2sql({
        SELECT: {
          from: { ref: ['Foo'] },
          having: [{ func: 'count', args: ['*'] }, '>', { val: 1 }],
        },
      })
      expect(sql).toMatchSnapshot()
    })

    test('in filter with 2 arg new notation', () => {
      const { sql } = cqn2sql({
        SELECT: {
          from: { ref: ['Foo'] },
          where: [{ ref: ['c'] }, '=', { func: 'concat', args: [{ ref: ['a'] }, { ref: ['b'] }] }],
        },
      })
      expect(sql).toMatchSnapshot()
    })

    test('in filter with 3 arg new notation', () => {
      const { sql, values } = cqn2sql({
        SELECT: {
          from: { ref: ['Foo'] },
          where: [{ ref: ['c'] }, '=', { func: 'concat', args: [{ val: 'Existing' }, { ref: ['a'] }, { val: '!' }] }],
        },
      })
      expect({ sql, values }).toMatchSnapshot()
    })

    test('in filter with nested functions new notation', () => {
      const { sql, values } = cqn2sql({
        SELECT: {
          from: { ref: ['Foo'] },
          where: [
            { func: 'lower', args: [{ ref: ['a'] }] },
            '=',
            {
              func: 'lower',
              args: [{ func: 'upper', args: [{ func: 'trim', args: [{ val: '   existing name  ' }] }] }],
            },
            'and',
            { func: 'length', args: [{ func: 'trim', args: [{ val: '  name' }] }] },
            '=',
            { ref: ['b'] },
          ],
        },
      })
      expect({ sql, values }).toMatchSnapshot()
    })

    test('in filter with subselect as function param', () => {
      const subselect = {
        SELECT: {
          columns: [{ ref: ['ID'] }],
          from: { ref: ['Foo2'] },
          where: [{ ref: ['a'] }, '=', { val: 1 }],
        },
      }
      const { sql } = cqn2sql({
        SELECT: {
          from: { ref: ['Foo'] },
          where: [{ ref: ['ID'] }, '=', { func: 'any', args: [subselect] }],
        },
      })
      expect(sql).toMatchSnapshot()
    })
  })

  describe('quoted column aliases', () => {
    // aliases should be quoted only for HANA
    test('simple select with column aliases', () => {
      const cqn = {
        SELECT: {
          from: { ref: ['Foo'], as: 'T' },
          columns: [
            { ref: ['a'], as: 'A' },
            { val: true, as: 'True' },
            { val: false, as: 'False' },
            { val: null, as: 'Null' },
            { func: 'count', args: ['*'], as: 'CountFunc' },
          ],
        },
      }
      const { sql } = cqn2sql(cqn)
      expect({ sql }).toMatchSnapshot()
    })

    // aliases should be quoted only for HANA
    test('select with subselect with in and column aliases', () => {
      const { sql, values } = cqn2sql(cqn.aliasWithInSubSelect)
      expect({ sql, values }).toMatchSnapshot()
    })

    // aliases should be quoted only for HANA
    test('select with subselect in exists and column aliases', () => {
      const { sql } = cqn2sql(cqn.aliasWithNestedExists)
      expect(sql).toMatchSnapshot()
    })

    // aliases should be quoted only for HANA
    test('select with simple subselect and column aliases', () => {
      const { sql } = cqn2sql(cqn.aliasWithSubSelect)
      expect(sql).toMatchSnapshot()
    })
  })

  describe('joins', () => {
    test.skip('with table join table', () => {
      const { sql } = cqn2sql(cqn.join)
      expect(sql).toMatchSnapshot()
    })
  })
})
