const assert = require('assert')
const cds = require('../cds.js')

// Set cds.root before requiring cds.Service as it resolves and caches package.json
// Call default cds.test API

describe('SELECT', () => {
  // chai.use(chaiAsPromised)
  const { data, expect } = cds.test(__dirname + '/resources')
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

    test('join', async () => {
      const res = await cds.run(CQL`
      SELECT A.bool
      FROM basic.projection.globals as A
      LEFT JOIN basic.projection.globals AS B
      ON A.bool=B.bool`)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
      for (let i = 0; i < res.length; i++) {
        const val = res[i].bool
        if (typeof val === 'object') {
          assert.strictEqual(val, null)
        } else {
          assert.strictEqual(typeof val, 'boolean')
        }
      }
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
      expect(ret.length).to.eq(1)
    })

    test('= regex behaves like string', async () => {
      expect(await SELECT.from('basic.projection.string').where('string =', /ye./)).to.have.property('length', 0)
      expect(await SELECT.from('basic.projection.string').where('string =', /yes/)).to.have.property('length', 1)
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
      cqn.SELECT.columns[0].val = function () { }

      await expect(cds.run(cqn)).rejected
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
          from: { ref: ['complex.associations.Authors'] },
          columns: [{ ref: ['ID'] }, { ref: ['name'] }, { ref: ['books'], expand: ['*', ...nulls(197)] }]
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
          from: { ref: ['complex.associations.Books'] },
          columns: [{ ref: ['ID'] }, { ref: ['title'] }, { ref: ['author'], expand: ['*', ...nulls(198)] }]
        },
      }

      const res = await cds.run(cqn)
      // ensure that all values are returned in json format
      assert.strictEqual(Object.keys(res[0].author).length, 200)
    })

    test('expand association with static values', async () => {
      const cqn = {
        SELECT: {
          from: { ref: ['complex.associations.unmanaged.Authors'] },
          columns: [{ ref: ['static'], expand: ['*'] }]
        },
      }

      const res = await cds.run(cqn)
      // ensure that all values are returned in json format
      assert.strictEqual(res[0].static.length, 1)
    })

    test.skip('invalid cast (wrong)', async () => {
      await expect(
        cds.run(CQL`
        SELECT
            'String' as ![string] : cds.DoEsNoTeXiSt
          FROM basic.projection.globals
        `),
        {
          message: 'Not supported type: cds.DoEsNoTeXiSt',
        },
      ).rejected
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
      const timestamp = dateTime.slice(0, -1) + '.000Z'
      await DELETE.from(entity)
      await INSERT({ dateTime }).into(entity)
      const dateTimeMatches = await SELECT('dateTime').from(entity).where(`dateTime = `, dateTime)
      assert.strictEqual(dateTimeMatches.length, 1, 'Ensure that the dateTime column matches the dateTime value')
      const timestampMatches = await SELECT('dateTime').from(entity).where(`dateTime = `, timestamp)
      assert.strictEqual(timestampMatches.length, 1, 'Ensure that the dateTime column matches the timestamp value')
    })

    test('combine expr and other compare', async () => {
      const cqn = CQL`SELECT bool FROM basic.literals.globals`
      cqn.SELECT.where = [
        {
          xpr: [
            {
              xpr: [{ ref: ['bool'] }, '!=', { val: true }]
            }
          ]
        },
        'and',
        { ref: ['bool'] }, '=', { val: false }
      ]
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 1, 'Ensure that all rows are coming back')
    })
      
    test('exists path expression', async () => {
      const cqn = {
        SELECT: {
          from: { ref: ["complex.associations.Books"] },
          where: [
            "exists",
            {
              ref: [
                "author",
                { id: "books", where: [{ ref: ["author", "name"] }, "=", { val: "Emily" }] }]
            }
          ]
        }
      }
      expect(cds.run(cqn)).to.eventually.be.rejectedWith('Only foreign keys of “author” can be accessed in infix filter, but found “name”');
    })

    test('exists path expression (unmanaged)', async () => {
      const cqn = {
        SELECT: {
          from: { ref: ["complex.associations.unmanaged.Books"] },
          where: [
            "exists",
            {
              ref: [
                "author",
                { id: "books", where: [{ ref: ["author", "name"] }, "=", { val: "Emily" }] }]
            }
          ]
        }
      }
      expect(cds.run(cqn)).to.eventually.be.rejectedWith('Unexpected unmanaged association “author” in filter expression of “books”');
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

  const generalLockTest = (lock4, shared = false) => {
    const isSQLite = () => cds.db.options.impl === '@cap-js/sqlite'

    const setMax = max => {
      let oldMax
      beforeAll(async () => {
        if (isSQLite()) return
        await cds.db.disconnect()
        oldMax = cds.db.pools._factory.options.max
        cds.db.pools._factory.options.max = max
      })

      afterAll(async () => {
        if (isSQLite()) return
        cds.db.pools._factory.options.max = oldMax
      })
    }

    let oldTimeout
    beforeAll(async () => {
      oldTimeout = cds.db.pools._factory.options.acquireTimeoutMillis
      cds.db.pools.undefined._config.acquireTimeoutMillis =
        cds.db.pools._factory.options.acquireTimeoutMillis = 1000
    })

    afterAll(() => {
      cds.db.pools.undefined._config.acquireTimeoutMillis =
        cds.db.pools._factory.options.acquireTimeoutMillis = oldTimeout
    })

    describe('pool max = 1', () => {
      setMax(1)
      test('output converters apply to for update', async () => {
        const query = lock4(true)
        const [result] = await query
        expect(result).to.have.all.keys(Object.keys(query.elements))
      })

      test('two locks on a single table', async () => {
        const tx1 = await cds.tx()
        const tx2 = await cds.tx()

        try {
          // Lock true
          await tx1.run(lock4(true))

          // Lock false
          await expect(tx2.run(lock4(false))).rejected
        } finally {
          await Promise.allSettled([tx1.commit(), tx2.commit()])
        }
      })

      test('same lock twice on a single table', async () => {
        const tx1 = await cds.tx()
        const tx2 = await cds.tx()

        try {
          // Lock false
          await tx1.run(lock4(false))

          // Lock false
          await expect(tx2.run(lock4(false))).rejected
        } finally {
          await Promise.allSettled([tx1.commit(), tx2.commit()])
        }
      })
    })

    describe('pool max > 1', () => {
      setMax(2)
      test('two locks on a single table', async () => {
        if (isSQLite()) return

        const tx1 = await cds.tx()
        const tx2 = await cds.tx()

        try {
          // Lock true
          await tx1.run(lock4(true))

          // Lock false
          await tx2.run(lock4(false))
        } finally {
          await Promise.allSettled([tx1.commit(), tx2.commit()])
        }
      })

      test('same lock twice on a single table', async () => {
        if (isSQLite()) return

        const tx1 = await cds.tx()
        const tx2 = await cds.tx()

        try {
          // Lock false
          await tx1.run(lock4(false))

          // Lock false
          if (shared) {
            const ret = await tx2.run(lock4(false))
            expect(ret).is.not.undefined
          } else {
            await expect(tx2.run(lock4(false))).rejected
          }
        } finally {
          await Promise.allSettled([tx1.commit(), tx2.commit()])
        }
      })
    })
  }

  describe('forUpdate', () => {
    const boolLock = SELECT.from('basic.projection.globals')
      .forUpdate({
        of: ['bool'],
        wait: 0,
      })

    generalLockTest(bool => boolLock.clone()
      .where([{ ref: ['bool'] }, '=', { val: bool }])
    )
  })

  describe('forShareLock', () => {
    const boolLock = SELECT.from('basic.projection.globals')
      .forShareLock({
        of: ['bool'],
        wait: 0,
      })

    generalLockTest(bool => boolLock.clone()
      .where([{ ref: ['bool'] }, '=', { val: bool }]),
      true
    )
  })

  describe('search', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  describe('count', () => {
    test('count is preserved with .map', async () => {
      const query = SELECT.from('complex.associations.Authors')
      query.SELECT.count = true
      const result = await query
      assert.strictEqual(result.$count, 1)
      const renamed = result.map(row => ({ key: row.ID, fullName: row.name }))
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
