const { describe, test } = require('./test')

const cds = require('@sap/cds')

// Max binary value for a signed 64-bit int
const max = -0b111111111111111111111111111111111111111111111111111111111111111n

const data = [{ $test: 'Integer64 Zero', Integer64: '0' }]

// Add all data to be test with up to 32 bit
let bin = '0b'
for (let i = 0; i < 63; i++) {
  bin += '1'
  data.push({ $test: `Integer64 1 << ${i}`, Integer64: BigInt(bin).toString() })
}
data.push({ $test: `Integer64 1 << 64`, Integer64: (BigInt(bin) * -1n).toString() })

describe('features', () => {
  test(
    'cds.builtin.types.cds.Integer64',
    (queries, model) => {
      model.target.elements.Integer64 = { type: 'cds.Integer64' }

      queries.INSERT.push(...data.map(d => cds.ql.INSERT(d).into('target')))
      queries.UPDATE.push(
        ...data.map(d =>
          cds.ql
            .UPDATE('target')
            .where({ $test: d.$test })
            .with({
              Integer64: (max ^ BigInt(d.Integer64)).toString(),
            }),
        ),
      )
    },
    results => {
      const errors = []
      const inserted = results.INSERT[0]
      for (let i = 0; i < inserted.length; i++) {
        const row = inserted[i]
        const testName = row.$test
        const orgData = data.find(d => d.$test === testName)
        if (!orgData) continue
        if (orgData.Integer64 !== row.Integer64)
          errors.push(new Error(`# cds.builtin.types # cds.Integer64 # can not store value "${orgData.Integer64}"`))
      }

      const updated = results.UPDATE[0]
      for (let i = 0; i < updated.length; i++) {
        const row = updated[i]
        const testName = row.$test
        const orgData = data.find(d => d.$test === testName)
        if (!orgData) continue
        const expected = (max ^ BigInt(orgData.Integer64)).toString()
        if (expected !== row.Integer64)
          errors.push(new Error(`# cds.builtin.types # cds.Integer64 # can not store value "${expected}"`))
      }

      return errors
    },
  )
})
