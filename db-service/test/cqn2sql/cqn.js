module.exports.select = {
  SELECT: {
    from: { ref: ['Foo'] },
  },
}
module.exports.selectF = {
  SELECT: {
    from: { ref: ['Foo2'] },
  },
}
module.exports.selectContainsOneColumn = {
  SELECT: {
    from: { ref: ['Foo'] },
    where: [
      {
        func: 'contains',
        args: [{ list: [{ ref: ['b'] }] }, { val: '5' }],
      },
    ],
  },
}

module.exports.selectWithColumns = {
  SELECT: {
    from: { ref: ['Foo'] },
    columns: [{ ref: ['a'] }, { ref: ['b'] }, { ref: ['c'] }],
  },
}
module.exports.selectWithColumnsEmptyOrderBy = {
  SELECT: {
    from: { ref: ['Foo'] },
    columns: [{ ref: ['a'] }, { ref: ['b'] }, { ref: ['c'] }],
    orderBy: [],
  },
}
module.exports.selectWithColumnsWithAsterisk = {
  SELECT: {
    from: { ref: ['Foo'] },
    columns: ['*'],
  },
}
module.exports.orderByWithAlias = {
  SELECT: {
    from: { ref: ['Foo'] },
    columns: [{ ref: ['a'] }, { ref: ['b'] }, { func: 'count', args: [{ ref: ['x'] }], as: 'count1' }],
    orderBy: [{ ref: ['count1'], sort: 'asc' }],
  },
}
module.exports.selectDistinct = {
  SELECT: {
    distinct: true,
    from: { ref: ['Foo'] },
    columns: [{ ref: ['a'] }, { ref: ['b'] }, { ref: ['c'] }],
  },
}
module.exports.selectWithCSN = {
  SELECT: {
    from: { ref: ['Foo'], as: 'T1' },
  },
  [Symbol.for('sap.cds.model')]: { test: 'model' },
}
module.exports.selectNonExistent = {
  SELECT: {
    columns: ['*'],
    from: { ref: ['¿HoWdIdYoUmAnAgeToCaLaNeNtItyThIsNaMe?'] },
  },
}

module.exports.selectWhereCqn = {
  SELECT: {
    from: { ref: ['Foo'] },
    where: [{ xpr: [{ ref: ['x'] }, '=', { val: 9 }] }],
  },
}
module.exports.selectWhereWithOnePlaceholderCqn = {
  SELECT: {
    from: { ref: ['Foo'] },
    where: [{ ref: ['ID'] }, '=', { ref: ['?'], param: true }],
  },
}
module.exports.selectWhereWithRefStringParamTrueCqn = {
  SELECT: {
    from: { ref: ['Foo'] },
    where: [{ ref: ['x'] }, '=', { ref: ['y'], param: true }],
  },
}
module.exports.selectWhereWithRefIntParamTrueCqn = {
  SELECT: {
    from: { ref: ['Foo'] },
    where: [{ ref: ['x'] }, '=', { ref: [7], param: true }],
  },
}
module.exports.selectWhereTwoCqn = {
  SELECT: {
    from: { ref: ['Foo'] },
    where: [{ xpr: [{ ref: ['x'] }, '+', { val: 9 }] }, '=', { val: 9 }],
  },
}
module.exports.selectWhereList = {
  SELECT: {
    from: { ref: ['Foo'] },
    where: [{ ref: ['x'] }, 'IN', { list: [{ val: 1 }, { val: 2 }, { val: 3 }] }],
  },
}
module.exports.selectWhereSelect = {
  SELECT: {
    from: { ref: ['Foo'] },
    columns: [{ ref: ['a'] }, { ref: ['b'] }, { ref: ['c'] }],
    where: [
      { ref: ['x'] },
      'IN',
      {
        SELECT: {
          from: { ref: ['Foo'] },
          columns: [{ ref: ['a'] }],
          where: [{ ref: ['x'] }, '<', { val: 9 }],
        },
      },
    ],
  },
}
module.exports.selectComplexWhere = {
  SELECT: {
    from: { ref: ['Foo'] },
    columns: [{ ref: ['a'] }, { ref: ['b'] }, { ref: ['c'] }],
    where: [
      '(',
      { ref: ['x'] },
      '+',
      { val: 1 },
      ')',
      '<',
      { val: 9 },
      'AND',
      { ref: ['x'] },
      'IN',
      {
        SELECT: {
          from: { ref: ['Foo'] },
          columns: [{ ref: ['a'] }],
          where: [{ ref: ['x'] }, '<', { val: 9 }],
        },
      },
    ],
  },
}
module.exports.selectWhereExists = {
  SELECT: {
    from: { ref: ['Foo'], as: 'T1' },
    where: [
      'exists',
      {
        SELECT: {
          from: { ref: ['Foo2'] },
        },
      },
    ],
  },
}
module.exports.selectWhereNestedExists = {
  SELECT: {
    from: { ref: ['Foo'], as: 'T2' },
    where: [
      'exists',
      {
        SELECT: {
          from: { ref: ['Books'], as: 'T1' },
          columns: [{ val: 1 }],
          where: [
            { ref: ['ID'] },
            '=',
            { val: 1 },
            'and',
            'exists',
            {
              SELECT: {
                from: { ref: ['Foo2'], as: 'T0' },
                columns: [{ val: 1 }],
                where: [
                  { ref: ['ID'] },
                  '=',
                  { val: 11 },
                  'and',
                  { ref: ['T1', 'ID'] },
                  '=',
                  {
                    ref: ['a'],
                  },
                ],
              },
            },
            'and',
            { ref: ['T2', 'ID'] },
            '=',
            {
              ref: ['ID'],
            },
          ],
        },
      },
    ],
  },
}
module.exports.selectHaving = {
  SELECT: {
    from: { ref: ['Foo'] },
    columns: [{ ref: ['a'] }, { ref: ['b'] }, { ref: ['c'] }],
    having: [{ ref: ['x'] }, '<', { val: 9 }],
  },
}
module.exports.selectFuncitonWithoutAlias = {
  SELECT: {
    from: { ref: ['Foo'] },
    columns: [{ xpr: [{ ref: ['x'] }, '+', { val: 1 }] }],
  },
}
module.exports.selectAggregationLimitOrder = {
  SELECT: {
    from: { ref: ['Foo'] },
    columns: [{ xpr: [{ ref: ['x'] }, '+', { val: 1 }], as: 'foo1' }, { ref: ['b'] }, { ref: ['c'] }],
    where: [{ ref: ['ID'] }, '=', { val: 111 }],
    groupBy: [{ ref: ['x'] }],
    having: [{ ref: ['x'] }, '<', { val: 9 }],
    orderBy: [{ ref: ['c'], sort: 'asc' }],
    limit: { rows: { val: 11 }, offset: { val: 22 } },
  },
}
module.exports.selectSubSelect = {
  SELECT: {
    from: { ref: ['Foo'] },
    columns: [
      { ref: ['a'] },
      { ref: ['b'], as: 'B' },
      { val: 1, as: 'C' },
      { xpr: [{ ref: ['x'] }, '+', { val: 2 }], as: 'D' },
      {
        SELECT: {
          from: { ref: ['Foo'] },
        },
        as: 'E',
      },
    ],
  },
}
module.exports.groupBy = {
  SELECT: {
    from: { ref: ['Foo'] },
    columns: [{ ref: ['a'] }, { ref: ['b'] }],
    groupBy: [{ ref: ['x'] }, { ref: ['c'] }],
  },
}

module.exports.one = {
  SELECT: {
    from: { ref: ['Foo'] },
    columns: [{ ref: ['a'] }, { ref: ['b'] }, { ref: ['c'] }],
    one: true,
  },
}
module.exports.oneWithLimit = {
  SELECT: {
    from: { ref: ['Foo'] },
    columns: [{ ref: ['a'] }, { ref: ['b'] }, { ref: ['c'] }],
    one: true,
    limit: { rows: { val: 2 }, offset: { val: 5 } },
  },
}
module.exports.limit = {
  SELECT: {
    from: { ref: ['Foo'] },
    columns: [{ ref: ['a'] }, { ref: ['b'] }, { ref: ['c'] }],
    limit: { rows: { val: 1 } },
  },
}
module.exports.limitOffset = {
  SELECT: {
    from: { ref: ['Foo'] },
    columns: [{ ref: ['a'] }, { ref: ['b'] }, { ref: ['c'] }],
    limit: { rows: { val: 1 }, offset: { val: 2 } },
  },
}

module.exports.selectWithFunctionWithoutAlias = {
  SELECT: {
    from: { ref: ['Foo'] },
    columns: [{ func: 'min', args: [{ ref: ['x'] }] }],
  },
}

module.exports.selectWithFunctionsWithoutAlias = {
  SELECT: {
    from: { ref: ['Foo'] },
    columns: [
      { func: 'min', args: [{ ref: ['x'] }] },
      { func: 'count', args: [{ val: 1 }] },
      { func: 'sum', args: [{ ref: ['x'] }] },
    ],
  },
}

module.exports.selectWithSameFunctionsWithoutAlias = {
  SELECT: {
    from: { ref: ['Foo'] },
    columns: [
      { func: 'count', args: ['*'] },
      { func: 'count', args: [{ val: 1 }] },
      { func: 'count', args: ['*'] },
    ],
  },
}

module.exports.selectWithAggregationNew = {
  SELECT: {
    from: { ref: ['Foo'] },
    columns: [
      { func: 'min', args: [{ ref: ['x'] }], as: 'foo1' },
      { ref: ['a'] },
      { func: 'count', args: ['*'], as: 'foo2' },
      { func: 'count', args: [{ val: 1 }], as: 'foo3' },
      { func: 'sum', args: [{ ref: ['x'] }], as: 'foo4' },
    ],
  },
}

module.exports.selectWithCountOne = {
  SELECT: {
    from: { ref: ['Foo'] },
    columns: [{ func: 'count', args: [{ val: 1 }] }],
  },
}

module.exports.selectWhereAggregationNew = {
  SELECT: {
    from: { ref: ['Foo'] },
    columns: [{ ref: ['a'] }, { ref: ['b'] }, { ref: ['c'] }],
    where: [{ func: 'max', args: [{ ref: ['x'] }] }, '<', { val: 9 }],
  },
}
module.exports.aliasWithInSubSelect = {
  SELECT: {
    from: { ref: ['Foo'] },
    columns: [
      { ref: ['a'], as: 'A' },
      { val: 'abc', as: 'ABC' },
      {
        xpr: [{ ref: ['x'] }, '+', { val: 1 }],
        as: 'Xpr1',
      },
    ],
    where: [
      '(',
      { ref: ['x'] },
      '+',
      { val: 1 },
      ')',
      '<',
      { val: 9 },
      'AND',
      { ref: ['x'] },
      'IN',
      {
        SELECT: {
          from: { ref: ['Foo'] },
          columns: [
            { ref: ['a'], as: 'B' },
            { xpr: [{ ref: ['x'] }, '-', { val: 4 }], as: 'Xpr2' },
          ],
          where: [{ ref: ['x'] }, '<', { val: 9 }],
        },
      },
    ],
  },
}

module.exports.aliasWithNestedExists = {
  SELECT: {
    from: { ref: ['Author'], as: 'T2' },
    where: [
      'exists',
      {
        SELECT: {
          from: { ref: ['Books'], as: 'T1' },
          columns: [
            { val: 1, as: 'One' },
            { xpr: [{ ref: ['code'] }], as: 'Xpr1' },
          ],
          where: [
            { ref: ['ID'] },
            '=',
            { val: 1 },
            'and',
            'exists',
            {
              SELECT: {
                from: { ref: ['Foo'], as: 'T0' },
                columns: [
                  { val: 3, as: 'Three' },
                  { xpr: [{ ref: ['x'] }, '+', { val: 1 }], as: 'Xpr2' },
                ],
                where: [
                  { ref: ['ID'] },
                  '=',
                  { val: 11 },
                  'and',
                  { ref: ['T1', 'ID'] },
                  '=',
                  {
                    ref: ['b'],
                  },
                ],
              },
            },
          ],
        },
      },
    ],
  },
}

module.exports.aliasWithSubSelect = {
  SELECT: {
    from: { ref: ['Foo'] },
    columns: [
      { ref: ['a'] },
      { ref: ['b'], as: 'B' },
      { val: 1, as: 'C' },
      { xpr: [{ ref: ['x'] }, '+', { val: 2 }], as: 'D' },
      {
        SELECT: {
          from: { ref: ['Foo'] },
          columns: [
            { ref: ['a'] },
            { ref: ['b'], as: 'B' },
            { val: false, as: 'False' },
            { xpr: [{ ref: ['x'] }, '+', { val: 2 }], as: 'Xpr' },
          ],
        },
        as: 'E',
      },
    ],
  },
}
module.exports.selectWhereSmaller = {
  SELECT: {
    from: { ref: ['Foo'] },
    where: [{ ref: ['x'] }, '<', { val: 9 }],
  },
}
module.exports.join = {
  SELECT: {
    from: {
      join: 'left',
      args: [
        { ref: ['Foo'], as: 'A' },
        { ref: ['Foo2'], as: 'B' },
      ],
      on: [{ ref: ['A', 'x'] }, '=', { ref: ['B', 'a'] }, 'AND', { ref: ['x'] }, '=', { val: 1 }],
    },
    columns: [{ ref: ['c'] }, { ref: ['b'] }, { ref: ['name'] }],
  },
}
module.exports.selectComplexWhereWithExists = {
  SELECT: {
    from: { ref: ['Foo'] },
    where: [
      { ref: ['ID'] },
      '=',
      { val: '123' },
      'and',
      '(',
      'exists',
      {
        SELECT: {
          columns: [{ ref: ['id'] }],
          from: { ref: ['Author'] },
          where: [{ ref: ['id'] }, '!=', { val: '' }],
        },
      },
      'or',
      'exists',
      {
        SELECT: {
          columns: [{ ref: ['ID'] }],
          from: { ref: ['Foo2'] },
          where: [{ ref: ['name'] }, '!=', { val: '' }],
        },
      },
      ')',
    ],
  },
}
