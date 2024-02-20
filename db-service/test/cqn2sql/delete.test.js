'use strict'
const cds = require('@sap/cds/lib')
const _cqn2sql = require('../../lib/cqn2sql')
function cqn2sql(q, m = cds.model) {
  return _cqn2sql(q, m)
} 

beforeAll(async () => {
  cds.model = await cds.load(__dirname + '/testModel').then(cds.linked)
})
describe('delete', () => {
  test('test with from entity', () => {
    const cqnDelete = DELETE.from(cds.model.definitions.Foo)
    const { sql } = cqn2sql(cqnDelete)
    expect(sql).toMatchSnapshot()
  })

  test('test with from ref', () => {
    const cqnDelete = {
      DELETE: {
        from: { ref: ['Foo'] },
      },
    }
    const { sql } = cqn2sql(cqnDelete)
    expect(sql).toMatchSnapshot()
  })

  test('test with from ref and alias', () => {
    const cqnDelete = {
      DELETE: {
        from: { ref: ['Foo'], as: 'lala' },
      },
    }
    const { sql } = cqn2sql(cqnDelete)
    expect(sql).toMatchSnapshot()
  })

  test('test with from string and where clause', () => {
    const cqnDelete = {
      DELETE: {
        from: 'Foo',
        where: [{ ref: ['x'] }, '<', { val: 9 }],
      },
    }
    const { sql } = cqn2sql(cqnDelete)
    expect(sql).toMatchSnapshot()
  })

  test("test simple cascade delete for entity with 'not in'", () => {
    const cqnDelete = {
      DELETE: {
        from: 'Foo',
        where: [
          {
            ref: ['x'],
          },
          'not in',
          {
            SELECT: {
              columns: [
                {
                  ref: ['a'],
                },
              ],
              from: { ref: ['Foo2'] },
            },
          },
        ],
      },
    }
    const { sql } = cqn2sql(cqnDelete)
    expect(sql).toMatchSnapshot()
  })

  test("test simple cascade delete for entity with 'not exists'", () => {
    const cqnDelete = {
      DELETE: {
        from: 'Books',
        where: [
          '(',
          {
            ref: ['author', 'id'],
          },
          'is not null',
          ')',
          'and',
          'not exists',
          {
            SELECT: {
              columns: [
                {
                  val: 1,
                  as: '_exists',
                },
              ],
              from: {
                ref: ['Author'],
              },
              where: [
                {
                  ref: ['id'],
                },
                '=',
                {
                  ref: ['parent', 'ID'],
                },
              ],
            },
          },
        ],
      },
    }
    const { sql } = cqn2sql(cqnDelete)
    expect(sql).toMatchSnapshot()
  })

  test("test complex cascade delete for entity with 'not exists'", () => {
    const cqnDelete = {
      DELETE: {
        from: 'Books',
        where: [
          '(',
          {
            ref: ['author', 'id'],
          },
          'is not null',
          'or',
          {
            ref: ['author', 'version'],
          },
          'is not null',
          ')',
          'and',
          'not exists',
          {
            SELECT: {
              columns: [
                {
                  val: 1,
                  as: '_exists',
                },
              ],
              from: {
                ref: ['Author'],
              },
              where: [
                {
                  ref: ['parent', 'ID'],
                },
                '=',
                {
                  ref: ['parent', 'code'],
                },
                'and',
                {
                  ref: ['parent', 'descr'],
                },
                '=',
                {
                  ref: ['Author', 'version'],
                },
              ],
            },
          },
        ],
      },
    }
    const { sql } = cqn2sql(cqnDelete)
    expect(sql).toMatchSnapshot()
  })
  // Do we need this test ?
  xtest("test complex reverse cascade delete for entity with 'exists'", () => {
    const cqnDelete = {
      DELETE: {
        from: 'sub1_1_1',
        where: [
          '(',
          {
            ref: ['sub1_1_1', 'sub1_1_parentForeignKey1_1_1'],
          },
          'is not null',
          'or',
          {
            ref: ['sub1_1_1', 'sub1_1_parentForeignVersion1_1_1'],
          },
          'is not null',
          ')',
          'and',
          'exists',
          {
            SELECT: {
              columns: [
                {
                  val: 1,
                  as: '_exists',
                },
              ],
              from: {
                ref: ['sub1_1'],
              },
              where: [
                {
                  ref: ['sub1_1_1', 'sub1_1_parentForeignKey1_1_1'],
                },
                '=',
                {
                  ref: ['sub1_1', 'key1_1'],
                },
                'and',
                {
                  ref: ['sub1_1_1', 'sub1_1_parentForeignVersion1_1_1'],
                },
                '=',
                {
                  ref: ['sub1_1', 'version1_1'],
                },
                'and',
                '(',
                '(',
                {
                  ref: ['sub1_1', 'sub1_parentForeignKey1_1'],
                },
                'is not null',
                'or',
                {
                  ref: ['sub1_1', 'sub1_parentForeignVersion1_1'],
                },
                'is not null',
                ')',
                'and',
                'exists',
                {
                  SELECT: {
                    columns: [
                      {
                        val: 1,
                        as: '_exists',
                      },
                    ],
                    from: {
                      ref: ['sub1'],
                    },
                    where: [
                      {
                        ref: ['sub1_1', 'sub1_parentForeignKey1_1'],
                      },
                      '=',
                      {
                        ref: ['sub1', 'key1'],
                      },
                      'and',
                      {
                        ref: ['sub1_1', 'sub1_parentForeignVersion1_1'],
                      },
                      '=',
                      {
                        ref: ['sub1', 'version1'],
                      },
                      'and',
                      '(',
                      '(',
                      {
                        ref: ['sub1', 'root_rootForeignKey1'],
                      },
                      'is not null',
                      'or',
                      {
                        ref: ['sub1', 'root_rootForeignVersion1'],
                      },
                      'is not null',
                      ')',
                      'and',
                      'exists',
                      {
                        SELECT: {
                          columns: [
                            {
                              val: 1,
                              as: '_exists',
                            },
                          ],
                          from: {
                            ref: ['root'],
                          },
                          where: [
                            {
                              ref: ['sub1', 'root_rootForeignKey1'],
                            },
                            '=',
                            {
                              ref: ['root', 'rootKey'],
                            },
                            'and',
                            {
                              ref: ['sub1', 'root_rootForeignVersion1'],
                            },
                            '=',
                            {
                              ref: ['root', 'rootVersion'],
                            },
                            'and',
                            '(',
                            {
                              ref: ['rootKey'],
                            },
                            '=',
                            {
                              val: 1,
                            },
                            'and',
                            {
                              ref: ['rootVersion'],
                            },
                            '=',
                            {
                              val: 'active',
                            },
                            ')',
                          ],
                        },
                      },
                      ')',
                    ],
                  },
                },
                ')',
              ],
            },
          },
        ],
      },
    }
    const expected = {
      sql: 'DELETE FROM sub1_1_1 WHERE ( sub1_1_1.sub1_1_parentForeignKey1_1_1 IS NOT NULL OR sub1_1_1.sub1_1_parentForeignVersion1_1_1 IS NOT NULL ) AND EXISTS ( SELECT 1 AS _exists FROM sub1_1 WHERE sub1_1_1.sub1_1_parentForeignKey1_1_1 = sub1_1.key1_1 AND sub1_1_1.sub1_1_parentForeignVersion1_1_1 = sub1_1.version1_1 AND ( ( sub1_1.sub1_parentForeignKey1_1 IS NOT NULL OR sub1_1.sub1_parentForeignVersion1_1 IS NOT NULL ) AND EXISTS ( SELECT 1 AS _exists FROM sub1 WHERE sub1_1.sub1_parentForeignKey1_1 = sub1.key1 AND sub1_1.sub1_parentForeignVersion1_1 = sub1.version1 AND ( ( sub1.root_rootForeignKey1 IS NOT NULL OR sub1.root_rootForeignVersion1 IS NOT NULL ) AND EXISTS ( SELECT 1 AS _exists FROM root WHERE sub1.root_rootForeignKey1 = root.rootKey AND sub1.root_rootForeignVersion1 = root.rootVersion AND ( rootKey = 1 AND rootVersion = ? ) ) ) ) ) )',
      values: ['active'],
    }
    expect(cqn2sql(cqnDelete)).toEqual(expected)
  })
})
