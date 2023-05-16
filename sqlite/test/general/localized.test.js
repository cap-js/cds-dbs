const cds = require('../../../test/cds.js')
const { GET, POST } = cds.test(__dirname, 'model.cds')

describe('localized', () => {
  beforeAll(async () => {
    return await POST('/test/fooLocalized', {
      ID: 5,
      text: 'english',
      texts: [{ locale: 'de', text: 'deutsch' }],
    })
  })

  test('generic request without language header falls back to default', async () => {
    const res = await GET('/test/fooLocalized')
    expect(res.status).toBe(200)

    expect(res.data).toEqual({
      '@odata.context': '$metadata#fooLocalized',
      value: [
        {
          ID: 5,
          text: 'english',
        },
      ],
    })
  })

  test('generic request with language header is localized', async () => {
    const res = await GET('/test/fooLocalized', { headers: { 'Accept-Language': 'de' } })
    expect(res.status).toBe(200)

    expect(res.data).toEqual({
      '@odata.context': '$metadata#fooLocalized',
      value: [
        {
          ID: 5,
          text: 'deutsch',
        },
      ],
    })
  })

  test('custom handler does not return localized by default', async () => {
    const db = await cds.connect.to('test')

    cds.context = { locale: 'de' }
    return db.tx(async () => {
      const result = await SELECT.from('test.fooLocalized')
      expect(result).toEqual([{ ID: 5, text: 'english' }])

      const resultLocalized = await SELECT.localized('test.fooLocalized')
      expect(resultLocalized).toEqual([{ ID: 5, text: 'deutsch' }])
    })
  })
})
