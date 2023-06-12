// process.env.DEBUG = 'sql'

const cds = require('@sap/cds')

const features = {}

test('features', async () => {
  const report = {}
  const matrix = fullMatrix(Object.keys(features))

  tests: for (let i = 0; i < matrix.length; i++) {
    const model = {
      target: {
        kind: 'entity',
        elements: {
          $test: { type: 'cds.String', notNull: true },
        },
      },
    }
    const queries = {
      SELECT: [cds.ql.SELECT().from('target')],
      INSERT: [],
      UPDATE: [],
      DELETE: [],
      UPSERT: [],
      STREAM: [],
    }

    const results = {}
    const errors = []

    const tests = matrix[i]
    try {
      for (let x = 0; x < tests.length; x++) {
        const applicable = await features[tests[x]].setup(queries, model)
        if (applicable === false) {
          continue tests
        }
      }

      cds.env.requires.db = { kind: 'better-sqlite' }
      await cds.deploy({ $sources: [], definitions: model })

      results.DEPLOY = await Promise.all(queries.SELECT.map(q => q.clone()))
      await Promise.all(queries.INSERT.map(q => q.clone()))
      results.INSERT = await Promise.all(queries.SELECT.map(q => q.clone()))
      await Promise.all(queries.UPDATE.map(q => q.clone()))
      results.UPDATE = await Promise.all(queries.SELECT.map(q => q.clone()))
      await Promise.all(queries.DELETE.map(q => q.clone()))
      results.DELETE = await Promise.all(queries.SELECT.map(q => q.clone()))
      await Promise.all(queries.UPSERT.map(q => q.clone()))
      results.UPSERT = await Promise.all(queries.SELECT.map(q => q.clone()))
      await Promise.all(queries.STREAM.map(q => q.clone()))
      results.STREAM = await Promise.all(queries.SELECT.map(q => q.clone()))

      // Run assert in reverse
      for (let x = tests.length - 1; x > -1; x--) {
        try {
          errors.push(...(await features[tests[x]].assert(results, queries, model)))
        } catch (err) {
          errors.push(err)
        }
      }
    } catch (err) {
      errors.push(err)
    }

    // Clean database connection pool
    await cds.db?.disconnect?.()

    // Clean cache
    delete cds.services._pending.db
    delete cds.services.db
    delete cds.db
    delete cds.model

    report[tests.join(' + ')] = errors
  }
  // eslint-disable-next-line no-console
  console.log(
    Object.keys(report)
      .map(k => {
        const errors = report[k]
        if (errors.length) {
          return `FAIL ${k}:\n    ${errors.map(e => e.message).join('\n    ')}`
        }
        return `PASS ${k}`
      })
      .join('\n') || cds.error`No tests found`,
  )
})

const fullMatrix = function (names) {
  const tests = []

  for (let i = 0; i < names.length; i++) {
    tests.push(...dimensionMatrix(names, i + 1))
  }

  return tests
}

const dimensionMatrix = function (names, dimensions) {
  const tests = []

  const end = names.length - (dimensions - 1)
  for (let i = 0; i < end; i++) {
    if (dimensions === 1) {
      tests.push([names[i]])
    } else {
      tests.push(...dimensionMatrix(names.slice(i + 1), dimensions - 1).map(t => [names[i], ...t]))
    }
  }

  return tests
}

module.exports = {
  describe,
  test: function (name, setup, assert) {
    features[name] = {
      setup,
      assert,
    }
  },
}
