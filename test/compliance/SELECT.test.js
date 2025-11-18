const assert = require('assert')
const cds = require('../cds.js')

describe('SELECT', () => {
  const { expect } = cds.test(__dirname + '/resources')

  describe('from', () => {
    test('table', async () => {
      const { globals } = cds.entities('basic.projection')
      const res = await cds.run(cds.ql`SELECT bool FROM ${globals}`)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
    })

    test('table *', async () => {
      const { globals } = cds.entities('basic.projection')
      const res = await cds.run(cds.ql`SELECT * FROM ${globals}`)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
    })

    test('projection', async () => {
      const { globals } = cds.entities('basic.projection')
      const res = await cds.run(cds.ql`SELECT bool FROM ${globals}`)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
    })

    test('join', async () => {
      const { globals } = cds.entities('basic.projection')
      const res = await cds.run(cds.ql`
      SELECT A.bool
      FROM ${globals} as A
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

    test('from select', async () => {
      const { globals } = cds.entities('basic.projection')
      const res = await cds.run(cds.ql`SELECT bool FROM (SELECT bool FROM ${globals}) AS nested`)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
    })

    test('from ref', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT * FROM ${string}[string = ${'yes'}]`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 1, `Ensure that only 'yes' matches`)
    })

    test('from non existant entity', async () => {
      const cqn = cds.ql`SELECT * FROM ![¿HoWdIdYoUmAnAgeToCaLaNeNtItyThIsNaMe?]`
      await expect(cds.run(cqn)).rejected
    })
  })

  describe('columns', () => {
    test('missing', async () => {
      const { globals } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT FROM ${globals}`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
      assert.strictEqual('bool' in res[0], true, 'Ensure that all columns are coming back')
    })

    test('star', async () => {
      const { globals } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT * FROM ${globals}`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
      assert.strictEqual('bool' in res[0], true, 'Ensure that all columns are coming back')
    })

    test('specific', async () => {
      const { globals } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT bool FROM ${globals}`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
      assert.strictEqual('bool' in res[0], true, 'Ensure that all columns are coming back')
    })

    test('statics', async () => {
      const { globals } = cds.entities('basic.projection')
      const res = await cds.run(cds.ql`
        SELECT
          null as ![nullt] : String,
          'String' as ![string],
          0 as ![integer],
          0.1 as ![decimal]
        FROM ${globals}
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

    test('select func', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT count() FROM ${string}`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 1, 'Ensure that all rows are coming back')
      assert.strictEqual(res[0].count, 3, 'Ensure that the function is applied')
    })

    test('select funcs', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT min(string),max(string),count() FROM ${string}`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 1, 'Ensure that all rows are coming back')
      assert.strictEqual(res[0].min, 'no', 'Ensure that the function is applied')
      assert.strictEqual(res[0].max, 'yes', 'Ensure that the function is applied')
      assert.strictEqual(res[0].count, 3, 'Ensure that the function is applied')
    })

    test('select funcs (duplicates)', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT count(*),count(1),count(string),count(char) FROM ${string}`
      await expect(cds.run(cqn)).rejected
    })

    test('select func alias', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT count() as count_renamed FROM ${string}`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 1, 'Ensure that all rows are coming back')
      assert.strictEqual(res[0].count_renamed, 3, 'Ensure that the function is applied and aliased')
    })

    test('select funcs alias', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`
      SELECT
        count(*) as count_star,
        count(1) as count_one,
        count(string) as count_string,
        count(char) as count_char
      FROM ${string}`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 1, 'Ensure that all rows are coming back')
      assert.strictEqual(res[0].count_star, 3, 'Ensure that the function is applied and aliased')
      assert.strictEqual(res[0].count_one, 3, 'Ensure that the function is applied and aliased')
      assert.strictEqual(res[0].count_string, 2, 'Ensure that the function is applied and aliased')
      assert.strictEqual(res[0].count_char, 0, 'Ensure that the function is applied and aliased')
    })

    test('select funcs alias (duplicates)', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT min(string) as count,max(string) as count,count() FROM ${string}`
      await expect(cds.run(cqn)).rejected
    })

    test('select function (wrong)', async () => {
      const { globals } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT 'func' as function : cds.String FROM ${globals}`
      cqn.SELECT.columns[0].val = function () { }
      await expect(cds.run(cqn)).rejected
    })

    test('select xpr', async () => {
      // REVISIT: Make HANAService ANSI SQL compliant by wrapping compare expressions into case statements for columns
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT (${'yes'} = string) as xpr : cds.Boolean FROM ${string} order by string`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
      assert.equal(res[0].xpr, null)
      assert.equal(res[1].xpr, false)
      assert.equal(res[2].xpr, true)
    })

    test('select calculation', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT (string || string) as string FROM ${string}`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
    })

    test('select sub select', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT (SELECT string FROM ${string} as sub WHERE sub.string = root.string) as string FROM ${string} as root`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
    })

    test('select 200 columns', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = SELECT(new Array(200).fill().map((_, i) => ({ as: `${i}`, val: i }))).from(string)
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
      assert.equal(Object.keys(res[0]).length, cqn.SELECT.columns.length)
    })

    const nulls = length => new Array(length).fill().map((_, i) => ({ as: `null${i}`, val: null }))
    test('select 200 null columns', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = SELECT(nulls(200)).from(string)
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
      const { Authors } = cds.entities('complex.associations')
      const cqn = SELECT([{ ref: ['ID'] }, { ref: ['name'] }, { ref: ['books'], expand: ['*', ...nulls(197)] }]).from(Authors)
      const res = await cds.run(cqn)
      // ensure that all values are returned in json format
      assert.strictEqual(Object.keys(res[0].books[0]).length, 200)
    })

    test('expand to one with 200 columns', async () => {
      const { Books } = cds.entities('complex.associations')
      const cqn = SELECT([{ ref: ['ID'] }, { ref: ['title'] }, { ref: ['author'], expand: ['*', ...nulls(198)] }]).from(Books)
      const res = await cds.run(cqn)
      // ensure that all values are returned in json format
      assert.strictEqual(Object.keys(res[0].author).length, 200)
    })

    test('expand association with static values', async () => {
      const { Authors } = cds.entities('complex.associations.unmanaged')
      const cqn = cds.ql`SELECT static{*} FROM ${Authors}`
      const res = await cds.run(cqn)
      // ensure that all values are returned in json format
      assert.strictEqual(res[0].static.length, 1)
    })

    test.skip('invalid cast (wrong)', async () => {
      const { globals } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT 'String' as ![string] : cds.DoEsNoTeXiSt FROM ${globals}`
      await expect(cds.run(cqn), { message: 'Not supported type: cds.DoEsNoTeXiSt' })
        .rejected
    })

    test('$now in view refers to tx timestamp', async () => {
      let ts, res1, res2
      await cds.tx(async tx => {
        ts = tx.context.timestamp
        // the statements are run explicitly in sequential order to ensure current_timestamp would create different timestamps
        res1 = await tx.run(SELECT.one.from('basic.projection.now_in_view'))
        res2 = await tx.run(SELECT.one.from('basic.projection.now_in_view'))
      })

      expect(res1.now).to.eq(ts.toISOString())
      expect(res1.now).to.eq(res2.now)
    })
  })

  describe('excluding', () => {
    test('without columns', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT FROM ${string} excluding { string }`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
      assert.strictEqual('string' in res[0], false, 'Ensure that excluded columns are missing')
    })

    test('with start', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT FROM ${string} { * } excluding { string }`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
      assert.strictEqual('string' in res[0], false, 'Ensure that excluded columns are missing')
    })

    test('with extra columns', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT FROM ${string} { *, ${'extra'} } excluding { string }`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
      assert.strictEqual('string' in res[0], false, 'Ensure that excluded columns are missing')
      assert.strictEqual('extra' in res[0], true, 'Ensure that specific columns are included')
    })

    test('with specific columns', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT FROM ${string} { string, char } excluding { string }`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
      assert.strictEqual('string' in res[0], true, 'Ensure that specific columns are included')
    })
  })

  describe('where', () => {
    test('empty where clause', async () => {
      const { globals } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT bool FROM ${globals}`
      cqn.SELECT.where = []
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
    })

    test('compare with DateTime column', async () => {
      const { dateTime: entity } = cds.entities('basic.literals')
      const sel = SELECT('dateTime').from(entity)
      const [{ dateTime }] = await sel.clone()
      const timestamp = new Date(dateTime)

      expect(await sel.clone().where(`dateTime = `, dateTime)).length(1)
      expect(await sel.clone().where(`dateTime = `, timestamp)).length(1)
      expect(await sel.clone().where(`dateTime = `, timestamp.toISOString())).length(1)
    })

    test('combine expr with nested functions and other compare', async () => {
      const { string } = cds.entities('basic.literals')
      const res = await cds.run(cds.ql`SELECT string FROM ${string} WHERE string != ${'foo'} and contains(tolower(string),tolower(${'bar'}))`)
      assert.strictEqual(res.length, 0, 'Ensure that no row is coming back')
    })

    test('combine expr and other compare', async () => {
      const { globals } = cds.entities('basic.literals')
      const res = await cds.run(cds.ql`SELECT bool FROM ${globals} WHERE (bool != ${true}) and bool = ${false}`)
      assert.strictEqual(res.length, 1, 'Ensure that all rows are coming back')
    })

    test('exists path expression', async () => {
      const { Books } = cds.entities('complex.associations')
      const cqn = cds.ql`SELECT * FROM ${Books} WHERE exists author.books[author.name = ${'Emily'}]`
      const res = await cds.run(cqn)
      expect(res[0]).to.have.property('title', 'Wuthering Heights')
    })

    test('exists path expression (unmanaged)', async () => {
      const { Books } = cds.entities('complex.associations.unmanaged')
      const cqn = cds.ql`SELECT * FROM ${Books} WHERE exists author.books[author.name = ${'Emily'}]`
      const res = await cds.run(cqn)
      expect(res[0]).to.have.property('title', 'Wuthering Heights')
    })

    test('like wildcard', async () => {
      const { string } = cds.entities('basic.projection')
      const res = await cds.run(cds.ql`SELECT string FROM ${string} WHERE string LIKE 'ye_'`)
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

    test('ref in list', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT string FROM ${string} WHERE string in (${'yes'},${'no'})`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 2, 'Ensure that all rows are coming back')
    })

    test('list in list of list', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT string FROM ${string} WHERE (string) in ((${'yes'}),(${'no'}))`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 2, 'Ensure that all rows are coming back')
    })

    test('list in list of list (static)', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT string FROM ${string} WHERE (string,${'static'}) in ((${'yes'},${'static'}),(${'no'},${'static'}))`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 2, 'Ensure that all rows are coming back')
    })

    test('ref in SELECT', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT string FROM ${string} WHERE string in (SELECT string from ${string})`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 2, 'Ensure that all rows are coming back')
    })

    test('ref in SELECT alias', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT string FROM ${string} WHERE string in (SELECT string as string_renamed from ${string})`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 2, 'Ensure that all rows are coming back')
    })

    test('param ?', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT string FROM ${string} WHERE string = ?`
      const res = await cds.run(cqn, ['yes'])
      assert.strictEqual(res.length, 1, 'Ensure that all rows are coming back')
    })

    // REVISIT: it is not yet fully supported to have named parameters on all databases
    test.skip('param named', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT string FROM ${string} WHERE string = :param`
      const res = await cds.run(cqn, { param: 'yes' })
      assert.strictEqual(res.length, 1, 'Ensure that all rows are coming back')
    })

    test.skip('param number', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT string FROM ${string} WHERE string = :7`
      const res = await cds.run(cqn, { 7: 'yes' })
      assert.strictEqual(res.length, 1, 'Ensure that all rows are coming back')
    })

    test('param multiple uses', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT string FROM ${string} WHERE string = ?`
      let res = await cds.run(cqn, ['yes'])
      assert.strictEqual(res.length, 1, 'Ensure that all rows are coming back')
      res = await cds.run(cqn, [''])
      assert.strictEqual(res.length, 0, 'Ensure that all rows are coming back')
      res = await cds.run(cqn, ['no'])
      assert.strictEqual(res.length, 1, 'Ensure that all rows are coming back')
    })

    test('func', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT string FROM ${string} WHERE concat(string, string) = 'yesyes'`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 1, 'Ensure that all rows are coming back')
    })

    test('random combination 1', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT string FROM ${string} WHERE (string || string) = ${'yesyes'} and string in (SELECT string from ${string} WHERE string = ${'yes'})`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 1, 'Ensure that all rows are coming back')
    })

    // search tests don't check results as the search behavior is undefined
    test('search one column', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = SELECT.from(string).where([{ func: 'search', args: [{ list: [{ ref: ['string'] }] }, { val: 'yes' }] }])
      await cds.run(cqn)
    })

    test('search multiple column', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT * FROM ${string} WHERE search((string,char,short,medium,large),${'yes'})`
      await cds.run(cqn)
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

    test('deep nested not', async () => {
      const { string } = cds.entities('basic.literals')
      const query = cds.ql`SELECT * FROM ${string} WHERE ${{ xpr: [CXL`not startswith(string,${'n'})`] }} ORDER BY string DESC`
      const res = await cds.run(query)
      assert.strictEqual(res[0].string, 'yes')
    })

    test('deep nested boolean function w/o operator', async () => {
      const { string } = cds.entities('basic.literals')
      const query = cds.ql`SELECT * FROM ${string} WHERE ${{ xpr: [CXL`startswith(string,${'n'})`] }} ORDER BY string DESC`
      const res = await cds.run(query)
      assert.strictEqual(res[0].string, 'no')
    })

    test('deep nested not + and', async () => {
      const { string } = cds.entities('basic.literals')
      const query = cds.ql`SELECT * FROM ${string} WHERE ${{ xpr: [CXL`not startswith(string,${'n'}) and not startswith(string,${'n'})`] }} ORDER BY string DESC`
      const res = await cds.run(query)
      assert.strictEqual(res[0].string, 'yes')
    })

    test('multiple levels of not negations of expressions', async () => {
      const { string } = cds.entities('basic.literals')
      const query = cds.ql`SELECT * FROM ${string} WHERE ${{ xpr: ['not', { xpr: ['not', CXL`not startswith(string,${'n'})`] }] }} ORDER BY string DESC`
      const res = await cds.run(query)
      assert.strictEqual(res[0].string, 'yes')
    })

    test('multiple not in a single deep nested expression', async () => {
      const { string } = cds.entities('basic.literals')
      const query = cds.ql`SELECT * FROM ${string} WHERE ${{ xpr: [CXL`not not not startswith(string,${'n'})`] }} ORDER BY string DESC`
      await cds.tx(async tx => {
        let res
        try {
          res = await tx.run(query)
        } catch (err) {
          if (tx.dbc.server.major < 4) return // not not is not supported by older HANA versions
          throw err
        }
        assert.strictEqual(res[0].string, 'yes')
      })
    })

    test('multiple levels of not negations of expression with not + and', async () => {
      const { string } = cds.entities('basic.literals')
      const query = cds.ql`SELECT * FROM ${string} WHERE ${{ xpr: ['not', { xpr: ['not', CXL`not startswith(string,${'n'}) and not startswith(string,${'n'})`] }] }} ORDER BY string DESC`
      const res = await cds.run(query)
      assert.strictEqual(res[0].string, 'yes')
    })

    test('multiple levels of not negations of expression with multiple not in a single expression', async () => {
      const { string } = cds.entities('basic.literals')
      const query = cds.ql`SELECT * FROM ${string} WHERE ${{ xpr: ['not', { xpr: ['not', CXL`not not not startswith(string,${'n'}) and not not not startswith(string,${'n'})`] }] }} ORDER BY string DESC`
      await cds.tx(async tx => {
        let res
        try {
          res = await tx.run(query)
        } catch (err) {
          if (tx.dbc.server.major < 4) return // not not is not supported by older HANA versions
          throw err
        }
        assert.strictEqual(res[0].string, 'yes')
      })
    })

    test('deep nested not before xpr with CASE statement', async () => {
      const { string } = cds.entities('basic.literals')
      const query = cds.ql`SELECT * FROM ${string} WHERE ${{ xpr: [{ xpr: ['not', CXL`string = 'no' ? true : false`] }] }} ORDER BY string DESC`
      const res = await cds.run(query)
      assert.strictEqual(res[0].string, 'yes')
    })

    test('deep nested multiple not before xpr with CASE statement', async () => {
      const { string } = cds.entities('basic.literals')
      const query = cds.ql`SELECT * FROM ${string} WHERE ${{ xpr: [{ xpr: ['not', 'not', 'not', CXL`string = 'no' ? true : false`] }] }} ORDER BY string DESC`
      await cds.tx(async tx => {
        let res
        try {
          res = await tx.run(query)
        } catch (err) {
          if (tx.dbc.server.major < 4) return // not not is not supported by older HANA versions
          throw err
        }
        assert.strictEqual(res[0].string, 'yes')
      })
    })

    test('deep nested not before CASE statement', async () => {
      const { string } = cds.entities('basic.literals')
      const query = cds.ql`SELECT * FROM ${string} WHERE ${{ xpr: [{ xpr: ['not', ...(CXL`string = 'no' ? true : false`).xpr] }] }} ORDER BY string DESC`
      const res = await cds.run(query)
      assert.strictEqual(res[0].string, 'yes')
    })

    test('deep nested multiple not before CASE statement', async () => {
      const { string } = cds.entities('basic.literals')
      const query = cds.ql`SELECT * FROM ${string} WHERE ${{ xpr: [{ xpr: ['not', 'not', 'not', ...(CXL`string = 'no' ? true : false`).xpr] }] }} ORDER BY string DESC`
      await cds.tx(async tx => {
        let res
        try {
          res = await tx.run(query)
        } catch (err) {
          if (tx.dbc.server.major < 4) return // not not is not supported by older HANA versions
          throw err
        }
        assert.strictEqual(res[0].string, 'yes')
      })
    })

    test('not before CASE statement', async () => {
      const { string } = cds.entities('basic.literals')
      const query = cds.ql`SELECT * FROM ${string} WHERE ${{ xpr: ['not', ...(CXL`string = 'no' ? true : false`).xpr] }} ORDER BY string DESC`
      const res = await cds.run(query)
      assert.strictEqual(res[0].string, 'yes')
    })

    test('and beetwen CASE statements', async () => {
      const { string } = cds.entities('basic.literals')
      const query = cds.ql`SELECT * FROM ${string} WHERE ${{ xpr: [...(CXL`string = 'no' ? true : false`).xpr, 'and', ...(CXL`string = 'no' ? true : false`).xpr] }} ORDER BY string DESC`
      const res = await cds.run(query)
      assert.strictEqual(res[0].string, 'no')
    })

    test('and beetwen CASE statements with not', async () => {
      const { string } = cds.entities('basic.literals')
      const query = cds.ql`SELECT * FROM ${string} WHERE ${{ xpr: ['not', ...(CXL`string = 'no' ? true : false`).xpr, 'and', 'not', ...(CXL`string = 'no' ? true : false`).xpr] }} ORDER BY string DESC`
      const res = await cds.run(query)
      assert.strictEqual(res[0].string, 'yes')
    })
  })

  describe('groupby', () => {
    test('single ref', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT string FROM ${string} GROUP BY string`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
    })

    test('multiple refs', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT string FROM ${string} GROUP BY string, char`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
    })

    test('static val', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT string FROM ${string} GROUP BY string,${'1'}`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
    })

    test('func', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT string FROM ${string} GROUP BY string,now()`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
    })

    test('func', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT string FROM ${string} GROUP BY string,now()`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
    })

    test('navigation with duplicate identifier in path', async () => {
      const { Books } = cds.entities('complex.associations')
      const res = await cds.ql`SELECT name { name } FROM ${Books} GROUP BY name.name`
      assert.strictEqual(res.length, 1, 'Ensure that all rows are coming back')
    })

    test('navigation with duplicate identifier in path and aggregation', async () => {
      const { Books } = cds.entities('complex.associations')
      const res = await cds.ql`SELECT name { name }, count(1) as total FROM ${Books} GROUP BY name.name`
      assert.strictEqual(res.length, 1, 'Ensure that all rows are coming back')
    })
  })

  describe('having', () => {
    test('ignore empty array', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT string FROM ${string}`
      cqn.SELECT.having = []
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
    })

    test('without groupby (not allowed)', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT string FROM ${string} HAVING string = ${'yes'}`
      await expect(cds.run(cqn)).rejected
    })

    test('with groupby', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT string FROM ${string} GROUP BY string HAVING string = ${'yes'}`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 1, 'Ensure that all rows are coming back')
    })
  })

  describe('orderby', () => {

    const _localeSort = (a, b) => a === b ? 0 : a === null ? -1 : b === null ? 1 : String.prototype.localeCompare.call(a, b)

    test('ignore empty array', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT string FROM ${string}`
      cqn.SELECT.orderBy = []
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
    })

    test('single ref', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT string FROM ${string} ORDER BY string`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
      const sorted = [...res].sort((a, b) => _localeSort(a.string, b.string))
      assert.deepEqual(res, sorted, 'Ensure that all rows are in the correct order')
    })

    test('single ref asc (explicit)', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT string FROM ${string} ORDER BY string asc`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
      const sorted = [...res].sort((a, b) => _localeSort(a.string, b.string))
      assert.deepEqual(res, sorted, 'Ensure that all rows are in the correct order')
    })

    test('single ref desc', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT string FROM ${string} ORDER BY string desc`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
      const sorted = [...res].sort((a, b) => _localeSort(b.string, a.string))
      assert.deepEqual(res, sorted, 'Ensure that all rows are in the correct order')
    })

    test('sort is case insensitive', async () => {
      const { string } = cds.entities('basic.literals')
      const mixedDesc = SELECT.from(string).columns('string').orderBy('string DeSc')
      const desc = SELECT.from(string).columns('string').orderBy('string desc')
      const mixedAsc = SELECT.from(string).columns('string').orderBy('string aSC')
      const asc = SELECT.from(string).columns('string').orderBy('string asc')

      expect(await cds.run(mixedDesc)).to.eql(await cds.run(desc))
      expect(await cds.run(mixedAsc)).to.eql(await cds.run(asc))
    })


    test('localized', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT string FROM ${string} ORDER BY string`
      cqn.SELECT.localized = true
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
      const sorted = [...res].sort((a, b) => _localeSort(a.string, b.string))
      assert.deepEqual(res, sorted, 'Ensure that all rows are in the correct order')
    })
  })

  describe('limit', () => {
    test('rows', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT string FROM ${string} ORDER BY string LIMIT ${1}`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 1, 'Ensure that all rows are coming back')
      assert.strictEqual(res[0].string, null, 'Ensure that the first row is coming back')
    })

    test('offset', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT string FROM ${string} ORDER BY string LIMIT ${1} OFFSET ${1}`
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 1, 'Ensure that all rows are coming back')
      assert.strictEqual(res[0].string, 'no', 'Ensure that the first row is coming back')
    })
  })

  const generalLockTest = (lock4, { shared = false, ignoreLocked = false } = {}) => {
    const isSQLite = () => cds.db.options.impl === '@cap-js/sqlite'

    const setMax = max => {
      let oldMax, oldTimeout
      beforeAll(async () => {
        const options = cds.db.pools._factory.options
        const activeOptions = cds.db.pools.undefined.options || cds.db.pools.undefined._config || {}

        oldMax = options.max || activeOptions.max
        oldTimeout = options.acquireTimeoutMillis || activeOptions.acquireTimeoutMillis

        if (isSQLite()) {
          activeOptions.acquireTimeoutMillis = options.acquireTimeoutMillis = 1000
          return
        }
        await cds.db.disconnect()

        options.max = max
        options.acquireTimeoutMillis = 1000
      })

      afterAll(async () => {
        const options = cds.db.pools._factory.options

        if (isSQLite()) {
          const activeOptions = cds.db.pools.undefined.options || cds.db.pools.undefined._config || {}
          activeOptions.acquireTimeoutMillis = options.acquireTimeoutMillis = oldTimeout
          return
        }
        await cds.db.disconnect()

        options.max = oldMax || 1
        options.acquireTimeoutMillis = oldTimeout
      })
    }

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
          if (shared || ignoreLocked) {
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

  describe.skip('forUpdate', () => {
    const boolLock = SELECT.from('basic.projection.globals')
      .forUpdate({
        of: ['bool'],
        wait: 0,
      })

    generalLockTest(bool => boolLock.clone()
      .where([{ ref: ['bool'] }, '=', { val: bool }])
    )
  })

  describe.skip('forShareLock', () => {
    const boolLock = SELECT.from('basic.projection.globals')
      .forShareLock({
        of: ['bool'],
        wait: 0,
      })

    generalLockTest(bool => boolLock.clone()
      .where([{ ref: ['bool'] }, '=', { val: bool }]),
      { shared: true }
    )
  })

  describe.skip('forUpdate ignore locked', () => {
    const boolLock = SELECT.from('basic.projection.globals')
      .forShareLock({
        of: ['bool'],
        ignoreLocked: true
      })

    generalLockTest(bool => boolLock.clone()
      .where([{ ref: ['bool'] }, '=', { val: bool }]),
      { ignoreLocked: true }
    )
  })

  describe('error', () => {
    test('all positional parameters', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT error('MESSAGE',('Arg1'),(short,medium,large)) FROM ${string}`
      cqn.SELECT.one = true
      const res = await cds.run(cqn)
      assert.ok(res.error, 'Ensure that the function is applied')
      const funcRes = JSON.parse(res.error)
      assert.deepStrictEqual(funcRes, {
        message: 'MESSAGE',
        args: ['Arg1'],
        targets: ['short', 'medium', 'large'],
      }, 'Ensure that the function reads correct parameters and returns the right values')
    })

    test('no parameters', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT error() FROM ${string}`
      cqn.SELECT.one = true
      const res = await cds.run(cqn)
      assert.ok(res.error, 'Ensure that the function is applied')
      const funcRes = JSON.parse(res.error)
      assert.deepStrictEqual(funcRes, {
        message: null,
        args: null,
        targets: null
      }, 'Ensure that the function reads correct parameters and returns the right values')
    })

    test('only positional message parameter', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT error('MESSAGE') FROM ${string}`
      cqn.SELECT.one = true
      const res = await cds.run(cqn)
      assert.ok(res.error, 'Ensure that the function is applied')
      const funcRes = JSON.parse(res.error)
      assert.deepStrictEqual(funcRes, {
        message: 'MESSAGE',
        args: null,
        targets: null,
      }, 'Ensure that the function reads correct parameters and returns the right values')
    })

    test('skipped optional args positional parameter', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT error('MESSAGE',null,(short)) FROM ${string}`
      cqn.SELECT.one = true
      const res = await cds.run(cqn)
      assert.ok(res.error, 'Ensure that the function is applied')
      const funcRes = JSON.parse(res.error)
      assert.deepStrictEqual(funcRes, {
        message: 'MESSAGE',
        args: null,
        targets: ['short'],
      }, 'Ensure that the function reads correct parameters and returns the right values')
    })

    test('all positional parameters skipped by passing null', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT error(null,null,null) FROM ${string}`
      cqn.SELECT.one = true
      const res = await cds.run(cqn)
      assert.ok(res.error, 'Ensure that the function is applied')
      const funcRes = JSON.parse(res.error)
      assert.deepStrictEqual(funcRes, {
        message: null,
        args: null,
        targets: null,
      }, 'Ensure that the function reads correct parameters and returns the right values')
    })

    test('nulls in lists are preserved', async () => {
      const { string } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT error('MESSAGE',(null,null),(null)) FROM ${string}`
      cqn.SELECT.one = true
      const res = await cds.run(cqn)
      assert.ok(res.error, 'Ensure that the function is applied')
      const funcRes = JSON.parse(res.error)
      assert.deepStrictEqual(funcRes, {
        message: 'MESSAGE',
        args: [null, null],
        targets: null, // REVISIT: (null) -> [null]: compiler currently treats single list elements as non list elements
      }, 'Ensure that the function reads correct parameters and returns the right values')
    })
  })

  describe('search', () => {
    // Make sure that the queries work, but never check their behavior as it is undefined

    test('single word', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT * FROM ${string}`
      cqn.SELECT.search = [{ val: 'yes' }]
      await cds.run(cqn)
    })

    test('single quoted word', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT * FROM ${string}`
      cqn.SELECT.search = [{ val: '"yes"' }]
      await cds.run(cqn)
    })

    test('multiple words', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT * FROM ${string}`
      cqn.SELECT.search = [{ val: 'yes no' }]
      await cds.run(cqn)
    })

    test('multiple quoted words', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT * FROM ${string}`
      cqn.SELECT.search = [{ val: '"yes" "no"' }]
      await cds.run(cqn)
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
    test('simple', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT string FROM ${string} ORDER BY string`
      cqn.SELECT.one = true
      const res = await cds.run(cqn)
      assert.strictEqual(!Array.isArray(res) && typeof res, 'object', 'Ensure that the result is an object')
      assert.strictEqual(res.string, null, 'Ensure that the first row is coming back and null values come first')
    })

    test('conflicting with limit clause', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT string FROM ${string} ORDER BY string LIMIT 2 OFFSET 1`
      cqn.SELECT.one = true
      const res = await cds.run(cqn)
      assert.strictEqual(!Array.isArray(res) && typeof res, 'object', 'Ensure that the result is an object')
      assert.strictEqual(res.string, 'no', 'Ensure that the second row is coming back')
    })
  })

  describe('distinct', () => {
    test('simple', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT string FROM ${string}`
      cqn.SELECT.distinct = true
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 3, 'Ensure that all rows are coming back')
    })

    test('static val', async () => {
      const { string } = cds.entities('basic.literals')
      const cqn = cds.ql`SELECT ${'static'} FROM ${string}`
      cqn.SELECT.distinct = true
      const res = await cds.run(cqn)
      assert.strictEqual(res.length, 1, 'Ensure that all rows are coming back')
    })
  })

  describe('foreach', () => {
    const process = function (row) {
      for (const prop in row) if (row[prop] != null) (this[prop] ??= []).push(row[prop])
    }

    test('cds/srv.foreach', () => cds.tx(async () => {
      const { all } = cds.entities('basic.projection')


      const expected = {}
      const rows = await cds.ql`SELECT FROM ${all}`
      for (const row of rows) process.call(expected, row)

      const aggregate = {}
      await cds.foreach(SELECT.from(all), process.bind(aggregate))
      expect(aggregate).deep.eq(expected)
    }))

    test('aggregate', () => cds.tx(async () => {
      const { all } = cds.entities('basic.projection')

      const cqn = cds.ql`SELECT FROM ${all}`

      const expected = {}
      const rows = await cqn.clone()
      for (const row of rows) process.call(expected, row)

      const aggregate = {}
      await cqn.clone().then(rows => rows.map(process.bind(aggregate)))
      expect(aggregate).deep.eq(expected)
    }))

    test('async iterator', () => cds.tx(async () => {
      const { all } = cds.entities('basic.projection')

      const cqn = cds.ql`SELECT FROM ${all}`

      const expected = {}
      const rows = await cqn.clone()
      for (const row of rows) process.call(expected, row)

      const aggregate = {}
      for await (const row of cqn.clone()) process.call(aggregate, row)
      expect(aggregate).deep.eq(expected)
    }))
  })

  describe('pipeline', () => {
    test('json stream', () => cds.tx(async () => {
      const { json } = require('stream/consumers')
      const { all } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT FROM ${all}`
      const expected = await cqn.clone()

      let result
      await cqn.clone().pipeline(async stream => { result = await json(stream) })
      expect(result).deep.eq(expected)
    }))

    test('req.res stream', () => cds.tx(async () => {
      const http = require('http')
      const { json } = require('stream/consumers')
      const { promisify } = require('util')

      const { all } = cds.entities('basic.projection')
      const cqn = cds.ql`SELECT FROM ${all}`

      // Start simple http server
      const srv = http.createServer((_, res) => cqn.pipeline(res))
      await promisify(srv.listen.bind(srv))()
      cds.once('shutdown', () => { srv.close() })

      const expected = await cqn.clone()

      const result = await new Promise((resolve, reject) => {
        const { port } = srv.address()
        const req = http.get(`http://localhost:${port}/`)
        req.on('error', reject)
        req.on('response', res => {
          // expect(res.headers).to.have.property('content-type').eq('application/json')
          expect(res.headers).to.have.property('transfer-encoding').eq('chunked')
          json(res).then(resolve, reject)
        })
      })

      expect(result).deep.eq(expected)
    }))
  })

  describe('expr', () => {
    const minimal = true

    const model = cds.load(__dirname + '/resources/db', { sync: true })
    const targetName = 'basic.projection.all'
    const { [targetName]: target } = model.definitions //cds.entities('basic.projection')

    const unified = {}

    // === Start defining ref ===
    unified.ref = Object.keys(target.elements)
      .map(e => {
        const ref = { ref: [e] }
        Object.defineProperty(ref, 'element', { configurable: true, value: target.elements[e] })
        if (ref.element.virtual) return false
        return ref
      })
      .filter(a => a)

    // const noUUIDRefs = ref => cds.builtin.types[ref.element?.type] !== cds.builtin.types.UUID
    const noBooleanRefs = ref => !(cds.builtin.types[ref.element?.type] instanceof cds.builtin.types.boolean.constructor)
    const noBinaryRefs = ref => !(cds.builtin.types[ref.element?.type] === cds.builtin.types.Binary || cds.builtin.types[ref.element?.type] === cds.builtin.types.LargeBinary)
    const noBlobRefs = ref => noBinaryRefs(ref) && cds.builtin.types[ref.element?.type] !== cds.builtin.types.LargeString
    const timeRefs = ref => cds.builtin.types[ref.element?.type] === cds.builtin.types.Time
    const dateRefs = ref => cds.builtin.types[ref.element?.type] === cds.builtin.types.Date
    const datetimeRefs = ref => cds.builtin.types[ref.element?.type] === cds.builtin.types.DateTime
    const timestampRefs = ref => cds.builtin.types[ref.element?.type] === cds.builtin.types.Timestamp
    const numberRefs = ref => cds.builtin.types[ref.element?.type] instanceof cds.builtin.types.number.constructor
    const stringRefs = ref => cds.builtin.types[ref.element?.type] instanceof cds.builtin.types.string.constructor && noBinaryRefs(ref)

    // === Start defining val ===
    unified.null = { val: null }

    unified.boolean = [
      { val: true },
      { val: false },
    ]

    unified.UUID = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F']
      .map(fill => ({ val: '00000000-0000-0000-0000-000000000000'.replace(/0/g, fill) }))

    unified.uinteger_positive = [
      { val: 1 },
    ]

    unified.uinteger = [
      { val: 0 },
      ...unified.uinteger_positive
    ]

    unified.integer = [
      ...unified.uinteger,
      ...unified.uinteger_positive.map(n => ({ val: -1 * n.val }))
    ]

    unified.float = [
      { val: 0.1 },
      { val: 0.9 },
      { val: 1.1 },
      { val: -0.1 },
      { val: -0.9 },
      { val: -1.1 },
    ]

    unified.numeric = [
      ...unified.integer,
      ...unified.float,
    ]

    unified.string = [
      { val: '' },
      { val: 'c' },
      { val: 'short' },
      { val: 'medium length string' },
      { val: ''.padEnd(5000, 'large length string') },
      { val: ''.padEnd(5001, 'overflowing length string') },
    ]

    unified.date = [
      { val: new Date() },
      { val: (new Date()).toISOString() },
    ]

    unified.time = [
      { val: '00:00:00' },
      { val: '23:59:59' },
    ]

    const cdsTypeVals = {
      'cds.Boolean': unified.boolean,
      'cds.UUID': unified.UUID,
      'cds.UInt8': unified.uinteger,
      'cds.Int16': unified.integer,
      'cds.Int32': unified.integer,
      'cds.Int64': unified.integer,
      'cds.Double': unified.numeric,
      'cds.Decimal': unified.numeric,
      'cds.String': unified.string,
      'cds.Date': unified.date,
      'cds.Time': unified.time,
      'cds.DateTime': unified.date,
      'cds.Timestamp': unified.date,
    }

    unified.val = [
      unified.null,
      ...unified.boolean,
      ...unified.UUID,
      ...unified.numeric,
      ...unified.string,
      ...unified.date,
      ...unified.time,
    ]
      .map(v => ({ ...v, as: 'val' }))

    // === Start defining func ===
    unified.window = [
      { func: 'row_number' },
      ...unified.ref.filter(numberRefs).map(ref => ({ func: 'avg', args: [ref] })),
      ...unified.ref.filter(noBlobRefs).map(ref => ({ func: 'count', args: [ref] })),
      { func: 'count', args: ['*'] },
      { func: 'count' },
      ...unified.ref.filter(noBlobRefs).filter(noBooleanRefs).map(ref => ({ func: 'max', args: [ref] })),
      ...unified.ref.filter(noBlobRefs).filter(noBooleanRefs).map(ref => ({ func: 'min', args: [ref] })),
      ...unified.ref.filter(numberRefs).map(ref => ({ func: 'sum', args: [ref] })),
    ]

    const windowOrdered = [
      { func: 'rank' },
      { func: 'dense_rank' },
      { func: 'percent_rank' },
      { func: 'cume_dist' },
      ...unified.uinteger_positive.map(n => ({ func: 'ntile', args: [n] })),
      ...['lag', 'lead'].map(func => {
        return unified.ref.filter(noBlobRefs).map(ref => {
          return [
            { func, args: [ref] },
            ...unified.uinteger_positive.map(offset => [
              { func, args: [ref, offset] },
              ...(unified[ref.element.type]?.map(def => ({ func, args: [ref, offset, def] })) || []),
            ]).flat(),
          ]
        }).flat()
      }).flat(),
      ...unified.ref.filter(noBlobRefs).map(ref => ({ func: 'first_value', args: [ref] })),
      ...unified.ref.filter(noBlobRefs).map(ref => ({ func: 'last_value', args: [ref] })),
      ...unified.ref.filter(noBlobRefs).map(ref =>
        unified.uinteger_positive.map(n => ({ func: 'nth_value', args: [ref, n] }))
      ).flat(),
    ]

    const overPartition = { xpr: ['PARTITION BY', unified.ref[0]] }
    const overOrderBy = { xpr: ['ORDER BY', unified.ref[0]] }
    const overPartitionOrderBy = { xpr: ['ORDER BY', unified.ref[0]] }
    unified.window = [
      ...unified.window.map(func => ({ as: func.func, xpr: [func, 'OVER', { xpr: [] }] })),
      ...(minimal ? [] : unified.window.map(func => ({ as: func.func, xpr: [func, 'OVER', overPartition] }))),
      ...(minimal ? [] : unified.window.map(func => ({ as: func.func, xpr: [func, 'OVER', overOrderBy] }))),
      ...(minimal ? [] : windowOrdered.map(func => ({ as: func.func, xpr: [func, 'OVER', overOrderBy] }))),
      ...unified.window.map(func => ({ as: func.func, xpr: [func, 'OVER', overPartitionOrderBy] })),
      ...windowOrdered.map(func => ({ as: func.func, xpr: [func, 'OVER', overPartitionOrderBy] })),
    ]

    unified.aggregate = [
      ...unified.ref.filter(numberRefs).map(ref => ({ func: 'average', args: [ref] })),
      ...unified.ref.filter(noBlobRefs).map(ref => ({ func: 'count', args: [ref] })),
      { func: 'count', args: ['*'] },
      { func: 'count' },
      ...unified.ref.filter(noBlobRefs).map(ref => ({ func: 'countdistinct', args: [ref] })),
      ...unified.ref.filter(noBlobRefs).filter(noBooleanRefs).map(ref => ({ func: 'max', args: [ref] })),
      ...unified.ref.filter(noBlobRefs).filter(noBooleanRefs).map(ref => ({ func: 'min', args: [ref] })),
      ...unified.ref.filter(numberRefs).map(ref => ({ func: 'sum', args: [ref] })),
      ...unified.ref.filter(stringRefs).filter(noBlobRefs).map(ref => ({ func: 'string_agg', args: [ref, { val: ',' }] })),
    ]

    unified.scalar = [
      // TODO: investigate search issue for nvarchar columns
      ...unified.ref.filter(ref => cds.builtin.types[ref.element?.type] === cds.builtin.types.LargeString).map(ref => {
        return unified.string.map(val => ({ func: 'search', args: [{ list: [ref] }, val] }))
      }).flat(),
      // ...unified.string.map(val => ({ func: 'search', args: [{ list: unified.ref.filter(stringRefs) }, val] })),
      ...unified.ref.filter(stringRefs).filter(noBooleanRefs).map(X => {
        return unified.ref.filter(stringRefs).filter(noBooleanRefs).slice(0, minimal ? 1 : undefined).map(Y => ({ func: 'concat', args: [X, Y] }))
      }).flat(),
      // argument less functions
      ...['current_date', 'current_time', 'current_timestamp', 'now', 'maxdatetime', 'mindatetime'].map(func => {
        return [
          { func },
          { func, args: [] },
        ]
      }).flat(),
      // X string function
      ...[
        'length', 'tolower', 'toupper', 'trim', // OData spec
        // 'soundex',
        'ltrim', 'rtrim',
      ].map(func => {
        return [
          ...unified.string.map(val => ({ func, args: [val] })),
          ...unified.ref.filter(stringRefs).map(ref => ({ func, args: [ref] })),
        ]
      }).flat(),
      // X,Y string functions
      ...['contains', 'indexof', 'startswith', 'endswith'].map(func => {
        return unified.ref.filter(stringRefs).map(ref => {
          return [
            ...unified.string.slice(0, minimal ? 1 : undefined).map(val => ({ func, args: [ref, val] })),
            ...unified.ref.filter(stringRefs).filter(noBlobRefs).slice(0, minimal ? 1 : undefined).map(ref2 => ({ func, args: [ref, ref2] }))
          ]
        }).flat()
      }).flat(),
      ...unified.ref.filter(stringRefs).map(ref => {
        return [
          ...unified.uinteger.slice(0, minimal ? 1 : undefined).map(offset => ({ func: 'substring', args: [ref, offset] })),
          ...unified.uinteger.slice(0, minimal ? 1 : undefined).map(offset => {
            return unified.uinteger.slice(0, minimal ? 1 : undefined).map(end => ({ func: 'substring', args: [ref, offset, end] }))
          }).flat(),
        ]
      }).flat(),
      ...unified.ref.filter(stringRefs).map(ref => ({ func: 'matchespattern', args: [ref, { val: '.*' }] })),
      // X numeric function
      ...[
        'ceiling', 'floor', 'round', // OData spec
        'abs', 'sign', 'sin', 'tan',
      ].map(func => {
        return [
          ...unified.numeric.map(val => ({ func, args: [val] })),
          ...unified.ref.filter(numberRefs).map(ref => ({ func, args: [ref] })),
        ]
      }).flat(),
      // X,Y numeric function
      ...['atan2', 'power'].map(func => {
        return unified.ref.filter(numberRefs).map(ref => {
          return unified.numeric.slice(0, minimal ? 1 : undefined).map(val => ({ func, args: [ref, val] }))
        })
          .flat()
      }).flat(),
      // numeric functions with picky inputs
      { func: 'acos', args: [{ val: 0 }] },
      { func: 'asin', args: [{ val: 0 }] },
      { func: 'atan', args: [{ val: 0 }] },
      { func: 'cos', args: [{ val: 0 }] },
      { func: 'exp', args: [{ val: 2 }] },
      { func: 'ln', args: [{ val: 2 }] },
      { func: 'sqrt', args: [{ val: 2 }] },
      { func: 'log', args: [{ val: 2 }, { val: 2 }] },
      { func: 'mod', args: [{ val: 2, cast: { type: 'cds.Integer' } }, { val: 2, cast: { type: 'cds.Integer' } }] },
      // X timestamp function
      ...['year', 'month', 'day', 'hour', 'minute', 'second', 'fractionalseconds'].map(func => {
        return [
          ...unified.date.map(val => ({ func, args: [val] })),
          ...unified.ref.filter(timestampRefs).map(ref => ({ func, args: [ref] })),
        ]
      }).flat(),
      // X datetime function
      ...['year', 'month', 'day', 'hour', 'minute', 'second'].map(func => {
        return [
          ...unified.date.map(val => ({ func, args: [val] })),
          ...unified.ref.filter(datetimeRefs).map(ref => ({ func, args: [ref] })),
        ]
      }).flat(),
      // X date function
      ...['year', 'month', 'day'].map(func => {
        return [
          ...unified.date.map(val => ({ func, args: [val] })),
          ...unified.ref.filter(dateRefs).map(ref => ({ func, args: [ref] })),
        ]
      }).flat(),
      // X time function
      ...['hour', 'minute', 'second'].map(func => {
        return [
          ...unified.date.map(val => ({ func, args: [val] })),
          ...unified.ref.filter(timeRefs).map(ref => ({ func, args: [ref] })),
        ]
      }).flat(),
      ...['$user.id', '$user.locale', '$valid.from', '$valid.to', '$now'].map(val => ({ func: 'session_context', args: [{ val }] })),
      ...unified.ref.map(ref => ({ func: 'coalesce', args: [ref, ref] })),
    ]

    unified.func = [
      ...unified.window,
      ...unified.aggregate,
      ...unified.scalar,
    ]

    // === Start defining xpr ===
    unified.comparators = [
      ...['=', '<>', '==', '!=', '>', '<', '>=', '<='].map(op => {
        return unified.ref.filter(noBlobRefs).map(ref => {
          const typeVals = cdsTypeVals[ref.element.type] || []
          return [
            ...[
              { xpr: [ref, op, ref] },
              { xpr: [ref, op, unified.null] },
              { xpr: [unified.null, op, ref] },
            ].slice(0, minimal ? 1 : undefined),
            ...typeVals.slice(0, minimal ? 1 : undefined).map(val => {
              val = { ...val, cast: ref.element }
              return [
                { xpr: [ref, op, val] },
                { xpr: [val, op, ref] },
                { xpr: [val, op, unified.null] },
                { xpr: [unified.null, op, val] },
              ].slice(0, minimal ? 1 : undefined)
            }).flat(),
          ]
        }).flat()
      }).flat(),
      ...['IN', 'NOT IN'].map(op => {
        return unified.ref.filter(noBlobRefs).map(ref => {
          return [
            { xpr: [ref, op, { list: [ref] }] },
            { xpr: [ref, op, { list: [ref, ref] }] },
            { xpr: [{ list: [ref] }, op, { list: [{ list: [ref] }] }] },
            { xpr: [{ list: [ref, ref] }, op, { list: [{ list: [ref, ref] }] }] },
            { xpr: [ref, op, SELECT(ref).from(targetName)] },
            { xpr: [{ list: [ref] }, op, SELECT(ref).from(targetName)] },
            { xpr: [{ list: [ref, ref] }, op, SELECT([{ ...ref, as: 'a' }, { ...ref, as: 'b' }]).from(targetName)] },
            // Repreating the previous statements replaceing ref with null
            { xpr: [unified.null, op, { list: [ref] }] },
            { xpr: [unified.null, op, { list: [ref, ref] }] },
            { xpr: [{ list: [unified.null] }, op, { list: [{ list: [ref] }] }] },
            { xpr: [{ list: [unified.null, unified.null] }, op, { list: [{ list: [ref, ref] }] }] },
            { xpr: [unified.null, op, SELECT(ref).from(targetName)] },
            { xpr: [{ list: [unified.null] }, op, SELECT(ref).from(targetName)] },
            { xpr: [{ list: [unified.null, unified.null] }, op, SELECT([{ ...ref, as: 'a' }, { ...ref, as: 'b' }]).from(targetName)] },
          ]
        }).flat()
      }).flat(),
      ...['LIKE', 'NOT LIKE'].map(op => {
        return unified.ref.filter(stringRefs).filter(noBlobRefs).map(ref => {
          return [
            { xpr: [ref, op, { val: '%' }] },
            { xpr: [ref, op, { val: '_' }] },
            { xpr: [ref, op, { val: '"' }] },
            { xpr: [ref, op, { val: "'" }] },
            ...unified.string.slice(0, minimal ? 1 : undefined).map(val => ({ xpr: [ref, op, val] })),
            ...unified.ref.filter(stringRefs).filter(noBlobRefs).slice(0, minimal ? 1 : undefined).map(ref2 => ({ xpr: [ref, op, ref2] })),
          ]
        }).flat()
      }).flat(),
      ...['BETWEEN', 'NOT BETWEEN'].map(op => {
        return unified.ref.filter(noBlobRefs).map(ref => {
          const typeVals = cdsTypeVals[ref.element.type] || []
          const nul = { ...unified.null, cast: ref.element }
          return [
            ...[
              { xpr: [ref, op, ref, 'AND', ref] },
              { xpr: [nul, op, ref, 'AND', ref] },
              { xpr: [ref, op, nul, 'AND', ref] },
              { xpr: [nul, op, nul, 'AND', ref] },
              { xpr: [ref, op, ref, 'AND', nul] },
              { xpr: [nul, op, ref, 'AND', nul] },
              { xpr: [ref, op, nul, 'AND', nul] },
            ].slice(0, minimal ? 1 : undefined),
            ...typeVals.slice(0, minimal ? 1 : undefined).map(val => {
              val = { ...val, cast: ref.element }
              return [
                { xpr: [val, op, ref, 'AND', ref] },
                { xpr: [ref, op, val, 'AND', ref] },
                { xpr: [val, op, val, 'AND', ref] },
                { xpr: [ref, op, ref, 'AND', val] },
                { xpr: [val, op, ref, 'AND', val] },
                { xpr: [ref, op, val, 'AND', val] },
              ].slice(0, minimal ? 1 : undefined)
            }).flat(),
          ]
        }).flat()
      }).flat(),
      ...['EXISTS', 'NOT EXISTS'].map(op => {
        return unified.ref.filter(noBlobRefs).map(ref => {
          return [
            { xpr: [op, SELECT.from(targetName)] },
            { xpr: [op, SELECT([ref]).from(targetName)] },
            { xpr: [op, SELECT([{ val: 1 }]).from(targetName)] },
          ]
        }).flat()
      }).flat(),
    ]

    unified.operators = [
      ...['*', '/', '+', '-'].map(op => {
        return unified.ref.filter(numberRefs).map(ref => {
          const typeVals = cdsTypeVals[ref.element.type] || []
          return [
            ...[
              { xpr: [ref, op, ref] },
              { xpr: [ref, op, unified.null] },
              { xpr: [unified.null, op, ref] },
            ].slice(0, minimal ? 1 : undefined),
            ...typeVals.map(val => {
              val = { ...val, cast: ref.element }
              return [
                { xpr: [ref, op, val] },
                { xpr: [val, op, ref] },
                { xpr: [val, op, unified.null] },
                { xpr: [unified.null, op, val] },
              ].slice(0, minimal ? 1 : undefined)
            }).flat(),
          ]
        }).flat()
      }).flat(),
    ]

    unified.xpr = (function* () {
      for (const comp of unified.comparators) {
        yield { xpr: ['CASE', 'WHEN', comp, 'THEN', { val: true }, 'ELSE', { val: false }, 'END'], as: 'xpr' }
        if (!minimal || unified.comparators[0] === comp) {
          yield { xpr: ['CASE', 'WHEN', { xpr: ['NOT', comp] }, 'THEN', { val: true }, 'ELSE', { val: false }, 'END'], as: 'xpr' }
          // for (const comp2 of unified.comparators) {
          yield { xpr: ['CASE', 'WHEN', comp, 'AND', comp, 'THEN', { val: true }, 'ELSE', { val: false }, 'END'], as: 'xpr' }
          yield { xpr: ['CASE', 'WHEN', comp, 'OR', comp, 'THEN', { val: true }, 'ELSE', { val: false }, 'END'], as: 'xpr' }
          // }
        }
      }
      for (const xpr of unified.operators) {
        xpr.as = 'xpr'
        yield xpr
      }
    })

    Object.defineProperty(unified.xpr, 'length', {
      get: () => (unified.comparators.length) + 3 + unified.operators.length
    })

    // === Start defining list ===
    unified.list = []

    // === Start defining SELECT ===
    unified.SELECT = (function* () {
      const wrap = col => {
        const ret = SELECT([col]).from(targetName).limit(1)
        ret.as = 'select'
        return ret
      }
      for (const col of unified.ref) {
        yield wrap(col)
      }
      for (const col of unified.val) {
        yield wrap(col)
      }
      for (const col of unified.func) {
        yield wrap(col)
      }
      for (const col of unified.xpr()) {
        yield wrap(col)
      }
      for (const col of unified.list) {
        yield wrap(col)
      }
    })

    Object.defineProperty(unified.SELECT, 'length', {
      get: () => (
        unified.ref.length +
        unified.val.length +
        unified.func.length +
        unified.xpr.length +
        unified.list.length
      )
    })

    const os = require('os')
    for (let type of ['ref', 'val', 'func', 'xpr', 'list', ...(minimal ? [] : ['SELECT'])]) {
      describe(`${type}: ${unified[type].length}`, () => {
        test('execute', async () => {
          const batchCount = Math.min(os.availableParallelism() - 1, cds.db.factory.options.max || 1)
          const batches = new Array(batchCount).fill('')
          const iterator = typeof unified[type] === 'function' ? unified[type]() : unified[type][Symbol.iterator]()
          const { [targetName]: target } = cds.entities
          await Promise.all(batches.map(() => cds.tx(async (tx) => {
            for (const t of iterator) {
              // limit(0) still validates that the query is valid, but improves test execution time
              await tx.run(SELECT([t]).from(target).limit(0))
            }
          })
            .catch(err => {
              if (err.name === 'TimeoutError') return
              throw err
            }))
          )
        })
      })
    }
  })
})
