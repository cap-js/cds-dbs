const { describe, test } = require('./test')

const cds = require('@sap/cds')

describe('features', () => {
  test(
    'cds.builtin.classes.association',
    (queries, model) => {
      // Association test requires base data to enhance
      if (queries.INSERT.length < 1) return false

      // Ensure that there is a key column
      model.target.elements.$test.key = true

      // Add managed self association
      model.target.elements.managedAssociation = { type: 'cds.Association', target: 'target' }

      // Add unmanaged self association
      model.target.elements.unmanagedAssociation = {
        type: 'cds.Association',
        target: 'target',
        cardinality: { src: 1, min: 1, max: 1 },
        on: [{ ref: ['unmanagedAssociation', '$test'] }, '=', { ref: ['$self', '$test'] }],
      }

      // Select expand data from managed association
      queries.SELECT.push(
        cds.ql
          .SELECT([
            { val: 'managed association expand', as: '$test' },
            { ref: ['managedAssociation'], expand: ['*'] },
          ])
          .from('target'),
      )

      // Select expand data from managed association
      queries.SELECT.push(
        cds.ql
          .SELECT([
            { val: 'unmanaged association expand', as: '$test' },
            { ref: ['unmanagedAssociation'], expand: ['*'] },
          ])
          .from('target'),
      )

      // REVISIT: path expressions should also work

      // Update all insert queries to include the associations
      const addAssoc = entry => {
        const copy = Object.assign({}, entry)
        copy.managedAssociation = { $test: entry.$test }
        copy.unmanagedAssociation = { $test: entry.$test }
        return copy
      }
      queries.INSERT.forEach(q => {
        q.INSERT.entries = q.INSERT.entries.map(addAssoc)
      })
    },
    (results, queries) => {
      const errors = []

      const managedQueryIndex = queries.SELECT.findIndex(
        q => q.SELECT.columns?.[0].val === 'managed association expand',
      )
      const unmanagedQueryIndex = queries.SELECT.findIndex(
        q => q.SELECT.columns?.[0].val === 'unmanaged association expand',
      )

      // Copy expand result set into flat result set for uniform assert structure
      results.INSERT[0].push(...results.INSERT[managedQueryIndex].map(r => r.managedAssociation))
      results.UPDATE[0].push(...results.UPDATE[managedQueryIndex].map(r => r.managedAssociation))

      results.INSERT[0].push(...results.INSERT[unmanagedQueryIndex].map(r => r.unmanagedAssociation))
      results.UPDATE[0].push(...results.UPDATE[unmanagedQueryIndex].map(r => r.unmanagedAssociation))

      return errors
    },
  )
})
