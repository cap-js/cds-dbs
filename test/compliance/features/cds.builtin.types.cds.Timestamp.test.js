const { describe, test } = require('./test')

const cds = require('@sap/cds')

const toTimestamp = function (date) {
  return new Date(date).toISOString().substring(0, 23) + '0000Z'
}

const maxString = '9999-12-31T23:59:59.1234567Z'
const max = new Date(maxString)

const data = [
  { $test: 'Timestamp 1970-01-01T00:00:00.0000000Z', Timestamp: toTimestamp(new Date(0)) },
  { $test: 'Timestamp 9999-12-31T23:59:59.1234567Z', Timestamp: maxString },
]

describe('features', () => {
  test(
    'cds.builtin.types.cds.Timestamp',
    (queries, model) => {
      model.target.elements.Timestamp = { type: 'cds.Timestamp' } // REVISIT: cds.Integer32 type can not deploy

      queries.INSERT.push(...data.map(d => cds.ql.INSERT(d).into('target')))
      queries.UPDATE.push(
        ...data.map(d =>
          cds.ql
            .UPDATE('target')
            .where({ $test: d.$test })
            .with({ Timestamp: toTimestamp(max ^ new Date(d.Timestamp)) }),
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
        if (orgData.Timestamp !== row.Timestamp)
          errors.push(new Error(`# cds.builtin.types # cds.Timestamp # can not store value "${orgData.Timestamp}"`))
      }

      const updated = results.UPDATE[0]
      for (let i = 0; i < updated.length; i++) {
        const row = updated[i]
        const testName = row.$test
        const orgData = data.find(d => d.$test === testName)
        if (!orgData) continue
        const expected = toTimestamp(max ^ new Date(orgData.Timestamp))
        if (expected !== row.Timestamp)
          errors.push(new Error(`# cds.builtin.types # cds.Timestamp # can not store value "${expected}"`))
      }

      return errors
    },
  )
})
