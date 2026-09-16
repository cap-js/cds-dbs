const cds = require('../cds')
const { text } = require('stream/consumers')
const { PassThrough, Readable } = require('stream')

describe('Decimal', () => {
  const { data, expect } = cds.test(__dirname + '/resources')

  test('plain', async () => {
    const { number } = cds.entities('basic.literals')

    await INSERT([
      { decimal: 1.0 },
      { decimal: 0.1 },
      { decimal: 9 },
    ]).into(number)

    const result = await cds.run(`SELECT decimal, cast(decimal as ${cds.requires.db.impl === '@cap-js/hana' ? 'nvarchar' : 'text'}) as string FROM ${number}`)
    console.log(cds.requires.db.credentials.driver, result)
  })

})