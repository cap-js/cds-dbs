const assert = require('assert')

const cds = require('../cds.js')

// Set cds.root before requiring cds.Service as it resolves and caches package.json
// Call default cds.test API

describe('SELECT', () => {
  const { data } = cds.test(__dirname + '/resources')
  data.autoIsolation(true)

  describe('from', () => {
    test('table', async () => {
      const res = await cds.run(CQL`SELECT bool FROM basic.literals.globals`)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
    })

    test('table *', async () => {
      const res = await cds.run(CQL`SELECT * FROM basic.literals.globals`)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
    })

    test('projection', async () => {
      const res = await cds.run(CQL`SELECT bool FROM basic.projection.globals`)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
    })

    test('statics', async () => {
      const res = await cds.run(CQL`
        SELECT
          null as ![nullt] : String,
          'String' as ![string],
          0 as ![integer],
          0.1 as ![decimal]
        FROM basic.projection.globals
      `)

      // Should return a row for each row inside the target table
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')

      // Should return
      res.forEach((row, i) => {
        assert.equal(row.nullt, null, `Ensure correct conversion. ${i}`)
        assert.equal(row.string, 'String', `Ensure correct conversion. ${i}`)
        assert.equal(row.integer, 0, `Ensure correct conversion. ${i}`)
        assert.equal(row.decimal, 0.1, `Ensure correct conversion. ${i}`)
      })
    })

    test('like wildcard', async () => {
      const res = await cds.run(CQL`
        SELECT string FROM basic.projection.string WHERE string LIKE 'ye_'
      `)

      assert.strictEqual(res.length, 1, `Ensure that only 'true' matches`)
    })

    test('like regex uses native regex support', async () => {
      let ret = await SELECT.from('basic.projection.string').where('string like', /ye./)
      expect(ret.length).toBe(1)
    })

    test('= regex behaves like string', async () => {
      await expect(SELECT.from('basic.projection.string').where('string =', /ye./)).resolves.toHaveProperty('length', 0)
      await expect(SELECT.from('basic.projection.string').where('string =', /yes/)).resolves.toHaveProperty('length', 1)
    })

    test('from select', async () => {
      const res = await cds.run(CQL`SELECT bool FROM (SELECT bool FROM basic.projection.globals) AS nested`)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
    })

    test('from ref', async () => {
      const cqn = {
        SELECT: {
          from: {
            ref: [
              {
                id: 'basic.projection.string',
                where: [
                  {
                    ref: ['string'],
                  },
                  '=',
                  {
                    val: 'yes',
                  },
                ],
              },
            ],
          },
        },
      }

      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 1, `Ensure that only 'yes' matches`)
    })

    test('select function (wrong)', async () => {
      const cqn = CQL`
        SELECT
          'func' as function : cds.String
        FROM basic.projection.globals
      `
      cqn.SELECT.columns[0].val = function () {}

      await assert.rejects(cds.run(cqn))
    })

    test.skip('select xpr', async () => {
      const cqn = {
        SELECT: {
          from: { ref: ['basic.projection.string'] },
          columns: [
            {
              xpr: [{ val: 'yes' }, '=', { ref: ['string'] }],
              as: 'xpr',
              cast: { type: 'cds.Boolean' },
            },
          ],
        },
      }

      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
      assert.equal(res[0].xpr, true)
      assert.equal(res[1].xpr, false)
      assert.equal(res[2].xpr, false)
    })

    test('select 200 columns', async () => {
      const cqn = {
        SELECT: {
          from: { ref: ['basic.projection.string'] },
          columns: new Array(200).fill().map((_, i) => ({ as: `${i}`, val: i })),
        },
      }

      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
      assert.equal(Object.keys(res[0]).length, cqn.SELECT.columns.length)
    })

    test('select 200 null columns', async () => {
      const cqn = {
        SELECT: {
          from: { ref: ['basic.projection.string'] },
          columns: new Array(200).fill().map((_, i) => ({ as: `null${i}`, val: null })),
        },
      }

      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
      // ensure that all null values are returned
      assert.strictEqual(Object.keys(res[0]).length, 200)
      res[0]
      cqn.SELECT.columns.forEach((c) => {
        assert.strictEqual(res[0][c.as], null)
      })
    })

    test('expand to many with 200 columns', async () => {
      const nulls = length => new Array(length).fill().map((_, i) => ({ as: `null${i}`, val: null }))
      const cqn = {
        SELECT: {
          from: { ref: ['complex.Authors'] },
          columns: [{ ref: ['ID']}, { ref: ['name']}, { ref: ['books'], expand: ['*', ...nulls(197)]}]
        },
      }

      const res = await cds.run(cqn)
      // ensure that all values are returned in json format
      assert.strictEqual(Object.keys(res[0].books[0]).length, 200)
    })

    test('expand to one with 200 columns', async () => {
      const nulls = length => new Array(length).fill().map((_, i) => ({ as: `null${i}`, val: null }))
      const cqn = {
        SELECT: {
          from: { ref: ['complex.Books'] },
          columns: [{ ref: ['ID']}, { ref: ['title']}, { ref: ['author'], expand: ['*', ...nulls(198)]}]
        },
      }

      const res = await cds.run(cqn)
      // ensure that all values are returned in json format
      assert.strictEqual(Object.keys(res[0].author).length, 200)
    })

    test.skip('invalid cast (wrong)', async () => {
      await assert.rejects(
        cds.run(CQL`
        SELECT
            'String' as ![string] : cds.DoEsNoTeXiSt
          FROM basic.projection.globals
        `),
        {
          message: 'Not supported type: cds.DoEsNoTeXiSt',
        },
      )
    })
  })

  describe('columns', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  describe('excluding', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  describe('where', () => {
    test('empty where clause', async () => {
      const cqn = CQL`SELECT bool FROM basic.literals.globals`
      cqn.SELECT.where = []
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
    })

    test('compare with DateTime column', async () => {
      const entity = `basic.literals.dateTime`
      const dateTime = '1970-02-02T10:09:34Z'
      const timestamp = dateTime.slice(0,-1) + '.000Z'
      await DELETE.from(entity)
      await INSERT({ dateTime }).into(entity)
      const dateTimeMatches = await SELECT('dateTime').from(entity).where(`dateTime = `, dateTime)
      assert.strictEqual(dateTimeMatches.length, 1, 'Ensure that the dateTime column matches the dateTime value')
      const timestampMatches = await SELECT('dateTime').from(entity).where(`dateTime = `, timestamp)
      assert.strictEqual(timestampMatches.length, 1, 'Ensure that the dateTime column matches the timestamp value')
    })

    test.skip('ref select', async () => {
      // Currently not possible as cqn4sql does not recognize where.ref.id: 'basic.projection.globals' as an external source
      const cqn = {
        SELECT: {
          from: { ref: ['basic.projection.string'] },
          where: [
            {
              ref: ['string'],
            },
            '=',
            {
              ref: [
                {
                  id: 'basic.projection.globals',
                },
                'bool',
              ],
            },
          ],
        },
      }

      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, `Ensure that only matches comeback`)
    })
  })

  describe('having', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  describe('groupby', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  describe('orderby', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  describe('limit', () => {
    describe('rows', () => {
      test.skip('missing', () => {
        throw new Error('not supported')
      })
    })

    describe('offset', () => {
      test.skip('missing', () => {
        throw new Error('not supported')
      })
    })
  })

  describe('forUpdate', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  describe('forShareLock', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  describe('search', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  describe('count', () => {
    test('count is preserved with .map', async () => {
      const query = SELECT.from('complex.Authors')
      query.SELECT.count = true
      const result = await query
      assert.strictEqual(result.$count, 1)
      const renamed = result.map(row => ({key: row.ID, fullName: row.name}))
      assert.strictEqual(renamed.$count, 1)
    })
  })

  describe('one', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  describe('distinct', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
})
