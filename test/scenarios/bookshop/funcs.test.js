const cds = require('../../cds.js')
const bookshop = require('path').resolve(__dirname, '../../bookshop')

describe('Bookshop - Functions', () => {
  const { expect, GET } = cds.test(bookshop)

  describe('String Functions', () => {
    test('concat', async () => {
      const res = await GET(`/browse/Books?$filter=concat(concat(author,', '),title) eq 'Edgar Allen Poe, Eleonora'`)
      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })

    test('contains', async () => {
      const res = await GET(`/browse/Books?$filter=contains(author,'Allen')`)
      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(2)
    })

    test('avg', async () => {
      const { Books } = cds.entities
      const res = await cds.run(CQL`SELECT from ${Books} { 
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

    test.skip('matchesPattern', async () => {
      // REVISIT: ERROR: Property 'matchesPattern' does not exist in type 'CatalogService.Books'
      const res = await GET(`/browse/Books?$filter=matchesPattern(author,'^A.*e$')`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(2)
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
    test.skip('hassubset', () => { })
    test.skip('hassubsequence', () => { })
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
          .where([`${func.func}('${data.value}') = `], result)

        if (data.type & func.type) {
          const res = await cqn
          expect(res.result).to.eq(result)
        } else {
          await expect(cqn).rejected
        }
      })
    })

    // REVISIT: does not seem database relevant
    test.skip('date', () => { })
    test('day', async () => {
      const res = await GET(`/browse/Books?$select=ID&$filter=day(1970-01-31T00:00:00.000Z) eq 31&$top=1`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })

    test('date function with null value', async () => {
      const { result } = await SELECT.one(`day(null) as result`)
      .from('sap.capire.bookshop.Books')

      expect(result).to.be.null
    })

    test.skip('fractionalseconds', async () => {
      // REVISIT: ERROR: Feature is not supported: Method "fractionalseconds" in $filter or $orderby query options
      const res = await GET(
        `/browse/Books?$select=ID&$filter=fractionalseconds(1970-01-01T00:00:00.321Z) eq 321&$top=1`,
      )

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })
    test('hour', async () => {
      const res = await GET(`/browse/Books?$select=ID&$filter=hour(1970-01-01T07:00:00.000Z) eq 7&$top=1`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })
    test.skip('maxdatetime', async () => {
      // REVISIT: ERROR: Feature is not supported: Method "maxdatetime" in $filter or $orderby query options
      const res = await GET(`/browse/Books?$select=ID&$filter=maxdatetime() eq 9999-12-31T23:59:59.999Z&$top=1`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })
    test.skip('mindatetime', async () => {
      // REVISIT: ERROR: Feature is not supported: Method "mindatetime" in $filter or $orderby query options
      const res = await GET(`/browse/Books?$select=ID&$filter=mindatetime() eq 0001-01-01T00:00:00.000Z&$top=1`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })
    test('minute', async () => {
      const res = await GET(`/browse/Books?$select=ID&$filter=minute(1970-01-01T00:32:00.000Z) eq 32&$top=1`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })
    test('month', async () => {
      const res = await GET(`/browse/Books?$select=ID&$filter=month(1970-03-01T00:00:00.000Z) eq 3&$top=1`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })
    test('now', async () => {
      // REVISIT: this test does not really proof much
      const res = await GET(`/browse/Books?$select=ID&$filter=now() gt 1970-03-01T00:00:00.000Z&$top=1`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })
    test('second', async () => {
      const res = await GET(`/browse/Books?$select=ID&$filter=second(1970-01-01T00:00:45.000Z) eq 45&$top=1`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })
    // REVISIT: does not seem database relevant
    test.skip('time', () => { })
    test.skip('totaloffsetminutes', async () => {
      // REVISIT: ERROR: Feature is not supported: Method "totaloffsetminutes" in $filter or $orderby query options
      const res = await GET(
        `/browse/Books?$select=ID&$filter=totaloffsetminutes(2000-01-01T23:45:13+10:30) eq -630&$top=1`,
      )

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })
    test.skip('totalseconds', async () => {
      // REVISIT: ERROR: Feature is not supported: Method "totalseconds" in $filter or $orderby query options
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
    test.skip('isOf', async () => {
      // REVISIT: ERROR: Feature is not supported: Expression "false" in $filter or $orderby query options
      // ??? "false"
      const res = await GET(`/browse/Books?$filter=isof(createdAt,Edm.Date)`)

      expect(res.status).to.be.eq(200)
      expect(res.data.value.length).to.be.eq(1)
    })
  })
})
