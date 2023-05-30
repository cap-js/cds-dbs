const cds = require('@sap/cds')

const msg = function (message) {
  return `# association # common # ${message}`
}

const prepareCommon = async function (ctx) {
  const data = {
    country: {
      code: 'de',
      name: 'Germany',
      descr: 'Germany the country',
    },
    language: {
      code: 'de_DE',
      name: 'German',
      descr: 'German the language',
    },
    currency: {
      code: 'eur',
      symbol: '€',
      minorUnit: 100,
      name: 'Euro',
      descr: 'Euro the currency',
    },
  }

  // Insert test data
  await Promise.all([
    ctx.db.run(cds.ql.UPSERT(data.country).into('sap.common.Countries')),
    ctx.db.run(cds.ql.UPSERT(data.language).into('sap.common.Languages')),
    ctx.db.run(cds.ql.UPSERT(data.currency).into('sap.common.Currencies')),
  ])

  return data
}

module.exports = [
  async function commonExpand(ctx) {
    const common = await prepareCommon(ctx)

    await Promise.all([
      ctx.db.run(cds.ql.UPSERT({}).into('complex.associations.common.common')),
      ctx.db.run(cds.ql.UPSERT(Object.assign({}, common)).into('complex.associations.common.common')),
    ])

    const res = await ctx.db.run(
      cds.ql
        .SELECT([
          '*',
          { ref: ['language'], expand: ['*'] },
          { ref: ['country'], expand: ['*'] },
          { ref: ['currency'], expand: ['*'] },
        ])
        .from('complex.associations.common.common'),
    )

    const errors = []

    try {
      expect(res[0]).toMatchObject({
        language: null,
        country: null,
        currency: null,
      })
    } catch (e) {
      errors.push(msg(`Expand on non existent child does not return 'null'`))
    }

    try {
      expect(res[1]).toMatchObject(common)
    } catch (e) {
      errors.push(msg(`Inserting structured association does not resolve foreign keys`))
    }

    if (errors.length) {
      throw new Error(errors.join('\n'))
    }
  },
]
