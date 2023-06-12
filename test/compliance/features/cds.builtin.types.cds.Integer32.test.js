const { describe, test } = require('./test')

const cds = require('@sap/cds')

// Max binary value for a signed 32-bit int
const max = -0b1111111111111111111111111111111

const data = [{ $test: 'Integer32 Zero', Integer32: 0 }]

// Add all data to be test with up to 32 bit
for (let i = 0; i < 31; i++) {
  data.push({ $test: `Integer32 1 << ${i}`, Integer32: 1 << i })
}

describe('features', () => {
  test(
    'cds.builtin.types.cds.Integer32',
    (queries, model) => {
      model.target.elements.Integer32 = { type: 'cds.Integer' } // REVISIT: cds.Integer32 type can not deploy

      queries.INSERT.push(...data.map(d => cds.ql.INSERT(d).into('target')))
      queries.UPDATE.push(
        ...data.map(d =>
          cds.ql
            .UPDATE('target')
            .where({ $test: d.$test })
            .with({ Integer32: max ^ d.Integer32 }),
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
        if (orgData.Integer32 !== row.Integer32)
          errors.push(new Error(`# cds.builtin.types # cds.Integer32 # can not store value "${orgData.Integer32}"`))
      }

      const updated = results.UPDATE[0]
      for (let i = 0; i < updated.length; i++) {
        const row = updated[i]
        const testName = row.$test
        const orgData = data.find(d => d.$test === testName)
        if (!orgData) continue
        const expected = max ^ orgData.Integer32
        if (expected !== row.Integer32)
          errors.push(new Error(`# cds.builtin.types # cds.Integer32 # can not store value "${expected}"`))
      }

      return errors
    },
  )
})
