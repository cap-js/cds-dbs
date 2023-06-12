const { describe, test } = require('./test')

const cds = require('@sap/cds')

const toDateTime = function (date) {
  return new Date(date).toISOString().substring(0, 19) + 'Z'
}

const max = new Date('9999-12-31T23:59:59')

const data = [
  { $test: 'DateTime 1970-01-01T00:00:00Z', DateTime: toDateTime(new Date(0)) },
  { $test: 'DateTime 9999-12-31T23:59:59Z', DateTime: toDateTime(max) },
]

describe('features', () => {
  test(
    'cds.builtin.types.cds.DateTime',
    (queries, model) => {
      model.target.elements.DateTime = { type: 'cds.DateTime' } // REVISIT: cds.Integer32 type can not deploy

      queries.INSERT.push(...data.map(d => cds.ql.INSERT(d).into('target')))
      queries.UPDATE.push(
        ...data.map(d =>
          cds.ql
            .UPDATE('target')
            .where({ $test: d.$test })
            .with({ DateTime: toDateTime(max ^ new Date(d.DateTime)) }),
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
        if (orgData.DateTime !== row.DateTime)
          errors.push(new Error(`# cds.builtin.types # cds.DateTime # can not store value "${orgData.DateTime}"`))
      }

      const updated = results.UPDATE[0]
      for (let i = 0; i < updated.length; i++) {
        const row = updated[i]
        const testName = row.$test
        const orgData = data.find(d => d.$test === testName)
        if (!orgData) continue
        const expected = toDateTime(max ^ new Date(orgData.DateTime))
        if (expected !== row.DateTime)
          errors.push(new Error(`# cds.builtin.types # cds.DateTime # can not store value "${expected}"`))
      }

      return errors
    },
  )
})
