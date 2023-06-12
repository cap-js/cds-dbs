const { describe, test } = require('./test')

const cds = require('@sap/cds')

describe('features', () => {
  test(
    'cds.builtin.classes.key',
    (queries, model) => {
      // Key test requires base data to enhance
      if (queries.INSERT.length < 1) return false

      // Create copy of target with compound key
      model.key = { kind: 'entity', elements: {} }
      Object.keys(model.target.elements).forEach(k => {
        model.key.elements[k] = Object.assign({}, model.target.elements[k], { key: true })
      })

      queries.SELECT.push(cds.ql.SELECT().from('key'))
      queries.INSERT.forEach(q => {
        queries.INSERT.push(cds.ql.INSERT(q.INSERT.entries).into('key'))
        queries.UPSERT.push(cds.ql.UPSERT(q.INSERT.entries).into('key'))
      })
    },
    (results, queries) => {
      const errors = []

      if (results.UPSERT.length !== results.INSERT.length) {
        errors.push(new Error(`# cds.builtin.classes # key # Is not being considered for UPSERT queries`))
      }

      return errors
    },
  )
})
