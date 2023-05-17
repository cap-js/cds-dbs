const { resolve } = require('path')
const cds = require('../../test/cds.js')
const project = resolve(__dirname, 'beershop')

process.env.DEBUG && jest.setTimeout(100000)

describe('CAP PostgreSQL Adapter', () => {
  const { GET, PUT, expect, data } = cds.test('serve', '--project', project).verbose()

  data.autoIsolation(true)
  data.autoReset(true)

  describe('Timezone Handling', () => {
    test('should respect db users timezone settings', async () => {
      //Set Different TimeZone
      //await cds.run(`alter user postgres set timezone = 'EST'`, []) //UTC,EST
      const beforeTimestamp = new Date()
      beforeTimestamp.setMilliseconds(0)
      await PUT(
        '/beershop/Beers/9e1704e3-6fd0-4a5d-bfb1-13ac47f7976b',
        {
          name: 'Changed name',
          ibu: 10,
        },

        {
          headers: {
            'Content-Type': 'application/json;charset=UTF-8;IEEE754Compatible=true',
          },
        },
      )

      //await cds.run(`alter user postgres set timezone = 'UTC'`, [])
      const response = await GET('/beershop/Beers/9e1704e3-6fd0-4a5d-bfb1-13ac47f7976b')
      const afterTimestamp = new Date()

      const modifiedAt = new Date(response.data.modifiedAt)
      expect(beforeTimestamp).to.be.lessThanOrEqual(modifiedAt)
      expect(modifiedAt).to.be.lessThanOrEqual(afterTimestamp)
    })
  })
})
