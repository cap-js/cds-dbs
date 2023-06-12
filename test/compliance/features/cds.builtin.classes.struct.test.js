const { describe, test } = require('./test')

describe('features', () => {
  test(
    'cds.builtin.classes.struct',
    (queries, model) => {
      // Association test requires base data to enhance
      if (queries.INSERT.length < 1) return false

      const otherElements = Object.keys(model.target.elements)

      // Add Structured data type
      model.target.elements.structuredType = { elements: { ...model.target.elements } }

      // Update all insert queries to include the structured type

      const addStruct = entry => {
        const copy = Object.assign({}, entry)
        for (let e of otherElements) {
          copy[`structuredType_${e}`] = copy[e]
        }
        return copy
      }

      queries.INSERT.forEach(q => {
        q.INSERT.entries = q.INSERT.entries.map(addStruct)
      })
    },
    results => {
      const prefix = 'structuredType_'
      const prefixLength = prefix.length

      results.INSERT[0].push(
        ...results.INSERT[0].map(r => {
          const ret = {}
          for (let e of Object.keys(r)) {
            if (e.startsWith(prefix)) {
              ret[e.substring(prefixLength)] = ret[e]
            }
          }
          return ret
        }),
      )

      return []
    },
  )
})
