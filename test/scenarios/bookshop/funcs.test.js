const cds = require('../../cds.js')
const bookshop = require('path').resolve(__dirname, '../../bookshop')
cds.test.in(bookshop)

describe('Bookshop - Functions', () => {
  const { expect, GET } = cds.test()

  describe('String Functions', () => {
    test('concat', async () => {
      const res = await GET(`/browse/Books?$filter=concat(concat(author,', '),title) eq 'Edgar Allen Poe, Eleonora'`)
      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)

      // Test concat with more then 2 arguments
      const { Books } = cds.entities('CatalogService')
      const cqnRes = await SELECT.from(Books).where`concat(author, ${', '}, title) = ${'Edgar Allen Poe, Eleonora'}`
      expect(cqnRes.length).to.be.eq(1)
    })

    test('contains', async () => {
      const res = await GET(`/browse/Books?$filter=contains(author,'Allen')`)
      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(2)
    })

    test('contains with search string that can not be found', async () => {
      const res = await GET(`/browse/Books?$filter=contains(author,'string that can not be found in any author name')`)
      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(0)
    })

    test('contains with search string null', async () => {
      const res = await GET(`/browse/Books?$filter=contains(author,null)`)
      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(0)
    })

    test('contains with explicit equals boolean value', async () => {
      const res = await GET("/browse/Books?$filter=contains(author,'Allen') eq true")
      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(2)
    })

    test('contains with explicit not equals boolean value', async () => {
      const res = await GET("/browse/Books?$filter=contains(author,'Allen') ne false")
      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(2)
    })

    test('avg', async () => {
      const { Books } = cds.entities
      const res = await cds.run(cds.ql`SELECT from ${Books} {
        average(stock) as avgStock
      }`)
      expect(res[0].avgStock).to.not.be.undefined
    })

    test('endswith', async () => {
      const [res, wrong] = await Promise.all([
        GET(`/browse/Books?$filter=endswith(author,'Poe')`),
        GET(`/browse/Books?$filter=endswith(author,'Allen')`),
      ])
      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(2)
      expect(wrong.status).to.be.eq(200)
      expect(wrong.data.value.length).to.be.eq(0)
    })

    test('not endswith finds null', async () => {
      const { Books } = cds.entities('sap.capire.bookshop')
      await cds.run(INSERT({ ID: 123, title: 'Harry Potter', stock: undefined }).into(Books))
      const res = await GET(`/browse/Books?$filter=not endswith(author,'Poe')`)
      expect(res.status).to.be.eq(200)
      expect(res.data.value.some(item => item.ID === 123)).to.be.true
      await cds.run(DELETE.from(Books).where({ ID: 123 }))
    })

    test('indexof', async () => {
      const res = await GET(`/browse/Books?$filter=indexof(author,'Allen') eq 6`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(2)
    })

    test('length', async () => {
      const res = await GET(`/browse/Books?$filter=length(author) eq 15`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(2)
    })

    test('startswith', async () => {
      const [res, wrong] = await Promise.all([
        GET(`/browse/Books?$filter=startswith(author,'Edgar')`),
        GET(`/browse/Books?$filter=startswith(author,'Poe')`),
      ])
      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(2)
      expect(wrong.status).to.be.eq(200)
      expect(wrong.data.value.length).to.be.eq(0)
    })

    test('not startswith finds null', async () => {
      const { Books } = cds.entities('sap.capire.bookshop')
      await cds.run(INSERT({ ID: 123, title: 'Harry Potter', stock: undefined }).into(Books))
      const res = await GET(`/browse/Books?$filter=not startswith(author,'Poe')`)
      expect(res.status).to.be.eq(200)
      expect(res.data.value.some(item => item.ID === 123)).to.be.true
      await cds.run(DELETE.from(Books).where({ ID: 123 }))
    })

    test('substring', async () => {
      const [three, two, negative] = await Promise.all([
        GET(`/browse/Books?$filter=substring(author,1,2) eq 'dg'`),
        GET(`/browse/Books?$filter=substring(author,5) eq ' Allen Poe'`),
        GET(`/browse/Books?$filter=substring(author,-3) eq 'Poe'`),
      ])

      expect(three.status).to.be.eq(200)
      expect(three.data.value.length).to.be.eq(2)

      expect(two.status).to.be.eq(200)
      expect(two.data.value.length).to.be.eq(2)

      expect(negative.status).to.be.eq(200)
      expect(negative.data.value.length).to.be.eq(2)
    })

    test('matchesPattern', async () => {
      // We use QL API as the OData adapter does not yet support matchesPattern
      const res1 = await SELECT.from('CatalogService.Books')
        .columns('author', 'title')
        .where`matchesPattern(author,${'^Ed'})`

      // function is case insensitive
      const res2 = await SELECT.from('CatalogService.Books')
        .columns('author', 'title')
        .where`matchespattern(author,${'^Ed'})`

      expect(res1.length).to.eq(res2.length).to.be.eq(2)
      expect(res1).to.deep.eq(res2).to.deep.include({ author: 'Edgar Allen Poe', title: 'Eleonora' })
      expect(res1).to.deep.eq(res2).to.deep.include({ author: 'Edgar Allen Poe', title: 'The Raven' })
    })

    test('tolower', async () => {
      const [res, wrong] = await Promise.all([
        GET(`/browse/Books?$filter=tolower(author) eq 'edgar allen poe'`),
        GET(`/browse/Books?$filter=tolower(author) eq 'Edgar Allen Poe'`),
      ])

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(2)

      expect(wrong.status).to.be.eq(200)
      expect(wrong.data.value.length).to.be.eq(0)
    })

    test('toupper', async () => {
      const [res, wrong] = await Promise.all([
        GET(`/browse/Books?$filter=toupper(author) eq 'EDGAR ALLEN POE'`),
        GET(`/browse/Books?$filter=toupper(author) eq 'Edgar Allen Poe'`),
      ])

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(2)

      expect(wrong.status).to.be.eq(200)
      expect(wrong.data.value.length).to.be.eq(0)
    })

    test('trim', async () => {
      const [res, wrong] = await Promise.all([
        GET(`/browse/Books?$filter=author eq trim('  Edgar Allen Poe  ')`),
        GET(`/browse/Books?$filter=author eq '  Edgar Allen Poe  '`),
      ])

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(2)

      expect(wrong.status).to.be.eq(200)
      expect(wrong.data.value.length).to.be.eq(0)
    })
  })

  describe('Collection Functions', () => {
    test.skip('hassubset', async () => {
      // error: 400 - Function 'hassubset' is not supported
      const { Books } = cds.entities('sap.capire.bookshop')
      await cds.run(INSERT.into(Books).columns(['ID', 'footnotes']).rows([123, ['1', '2', '3']]))
      await cds.run(INSERT.into(Books).columns(['ID', 'footnotes']).rows([124, ['2', '5', '6']]))
      const res = await GET(`/browse/Books?$filter=hassubset(footnotes, ['3','1'])`)
      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })
    test.skip('hassubsequence', async () => {
      // error: 400 - Function 'hassubsequence' is not supported
      const { Books } = cds.entities('sap.capire.bookshop')
      await cds.run(INSERT.into(Books).columns(['ID', 'footnotes']).rows([123, ['1', '2', '3']]))
      await cds.run(INSERT.into(Books).columns(['ID', 'footnotes']).rows([124, ['2', '5', '6']]))
      const res = await GET(`/browse/Books?$filter=hassubset(footnotes, ['1','3'])`)
      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })
  })

  describe('Arithmetic Functions', () => {
    test('ceiling', async () => {
      const res = await GET(`/browse/Books?$filter=ceiling(price) eq 14`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(2)
    })

    test('floor', async () => {
      const res = await GET(`/browse/Books?$filter=floor(price) eq 13`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })

    test('round', async () => {
      const res = await GET(`/browse/Books?$filter=round(price) eq 13`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })
  })

  describe('Date and Time Functions', () => {

    const types = {
      invalid: 0,
      time: 1,
      date: 2,
    }

    const toDate = d => new Date(
      d.type === (types.date | types.time)
        ? d.value.endsWith('Z') ? d.value : d.value + 'Z'
        : d.type & types.time
          ? '1970-01-01T' + d.value + 'Z'
          : d.type & types.date
            ? d.value + 'T00:00:00Z'
            : d.value
    )

    const data = [
      { value: '1970-01-02', type: types.date },
      { value: '1970-01-02T03:04:05', type: types.time | types.date },
      { value: '03:04:05', type: types.time },
      { value: 'INVALID', type: types.invalid },
    ]

    const funcs = [
      { func: 'year', type: types.date, extract: d => new Date(d.value).getUTCFullYear() },
      { func: 'month', type: types.date, extract: d => toDate(d).getUTCMonth() + 1 },
      { func: 'day', type: types.date, extract: d => toDate(d).getUTCDate() },
      { func: 'hour', type: types.time | types.date, extract: d => toDate(d).getUTCHours() },
      { func: 'minute', type: types.time | types.date, extract: d => toDate(d).getUTCMinutes() },
      { func: 'second', type: types.time | types.date, extract: d => toDate(d).getUTCSeconds() },
    ]

    /**
     * Test every combination of date(/)time function with date(/)time type
     * year, month and day only accept types that contain a date
     * hour, minute, second accept all date(/)time types by returning 0
     */
    describe.each(funcs)('$func', (func) => {
      test.each(data)('val $value', async (data) => {
        const result = data.type ? func.extract(data) : data.value
        const cqn = SELECT.one(`${func.func}('${data.value}') as result`)
          .from('sap.capire.bookshop.Books')
          .where(`${func.func}('${data.value}') = `, result)

        if (data.type & func.type) {
          const res = await cqn
          expect(res.result).to.eq(result)
        } else {
          await expect(cqn).rejected
        }
      })
    })

    test('date', async () => {
      const res = await GET(`/browse/Books?$select=ID,createdAt&$filter=date(2023-03-29T15:44:58.999Z) eq 2023-03-29&$top=1`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })

    test('day', async () => {
      const res = await GET(`/browse/Books?$select=ID&$filter=day(1970-01-31T00:00:00.000Z) eq 31&$top=1`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })

    test('day function with null value', async () => {
      const { result } = await SELECT.one(`day(null) as result`)
        .from('sap.capire.bookshop.Books')

      expect(result).to.be.null
    })

    test('fractionalseconds', async () => {
      const res = await GET(
        `/browse/Books?$select=ID&$filter=fractionalseconds(1970-01-01T00:00:01.321Z) ge 0.311&$top=1`,
      )

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })

    test('hour', async () => {
      const res = await GET(`/browse/Books?$select=ID&$filter=hour(1970-01-01T07:00:00.000Z) eq 7&$top=1`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })

    test('maxdatetime', async () => {
      const res = await GET(`/browse/Books?$select=ID&$filter=maxdatetime() eq 9999-12-31T23:59:59.999Z&$top=1`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })

    test('mindatetime', async () => {
      const res = await GET(`/browse/Books?$select=ID&$filter=mindatetime() eq 0001-01-01T00:00:00.000Z&$top=1`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })

    test('minute', async () => {
      const res = await GET(`/browse/Books?$select=ID&$filter=minute(1970-01-01T00:32:10.000Z) eq 32&$top=1`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })

    test('month', async () => {
      const res = await GET(`/browse/Books?$select=ID&$filter=month(1970-03-01T00:00:00.000Z) eq 3&$top=1`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })

    test('now', async () => {
      const db = await cds.connect.to('db')
      return db.run(async tx => {
        Object.defineProperty(cds.context, 'timestamp', { value: new Date('1972-09-15T21:36:51.123Z') })
        const cqn = {
          SELECT: {
            from: { ref: ['localized.CatalogService.Books'], as: 'Books' },
            columns: [{ ref: ['Books', 'ID'] }],
            where: [
              {
                func: 'now',
                args: [],
              },
              '=',
              {
                val: '1972-09-15T21:36:51.123Z',
              },
            ],
          },
        }
        const res = await tx.run(cqn)
        expect(res.length).to.be.eq(5)
      })
    })

    test('second', async () => {
      const res = await GET(`/browse/Books?$select=ID&$filter=second(1970-01-01T00:00:45.123Z) eq 45&$top=1`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })

    test('time', async () => {
      const res = await GET(`/browse/Books?$select=ID,createdAt&$filter=time(2023-03-29T15:44:58.999Z) eq 15:44:58&$top=1`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })

    test.skip('totalseconds', async () => {
      // error: 400 - Property 'duration' does not exist in 'CatalogService.Books'
      const res = await GET(`/browse/Books?$select=ID&$filter=totalseconds(duration'P1DT06H32M45.000S') gt 0&$top=1`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })

    test('year', async () => {
      const res = await GET(`/browse/Books?$select=ID&$filter=year(1971-01-01T00:00:00.000Z) eq 1971&$top=1`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })
  })

  describe('Type Functions', () => {
    test.skip('cast', async () => {
      // error: 400 - Function 'cast' is not supported
      const res = await GET(`/browse/Books?$filter=cast(price,Edm.Int32) eq 13`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })
    test.skip('isOf', async () => {
      // error: 400 - Function 'isof' is not supported
      const res = await GET(`/browse/Books?$filter=isof(createdAt,Edm.Date)`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })
  })

  describe('Geo Functions', () => {
    test.skip('geo.distance', async () => {
      // error: 400 - Parsing URL failed at position 34: Expected "/" or a whitespace but "(" found.
      const res = await GET(`/browse/Books?$filter=geo.distance(geography'POINT(-122.131577 47.678581)', geography'POINT(-122.374722,37.618888)') lt 900.0`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })
    test.skip('geo.intersects', () => { })
    test.skip('geo.length', () => { })
  })
})
