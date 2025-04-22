'use strict'

const { getValidationQuery, buildMessage, constraintStorage, getWhereOfPatch, getConstraintsByTarget } = require('./utils')

function attachConstraints(_res, req) {
  // TODO: validate csv imports?
  if (Array.isArray(req.data[0])) return

  // for each entity involved in the request, collect their constraints
  const byTarget = getConstraintsByTarget(req.target, req.data)
  if (!byTarget.size) return

  // will be added as condition to queries against req.target
  const patchWhere = getWhereOfPatch(req)
  const queries = []

  for (const [target, constraints] of byTarget) {
    queries.push(getValidationQuery(target, constraints, patchWhere, req.target.name))
  }

  if (queries.length) constraintStorage.add(this.tx, queries)
}

/**
 * Validate the constraint‑check queries collected in the current transaction.
 *
 * – runs all assertion queries of the current transaction,
 * – raises `req.error(400, …)` for each violated constraint,
 * – resets the constraint storage for the current transaction.
 */
async function checkConstraints(req) {
  const queries = constraintStorage.get(this.tx)

  const results = await this.run(queries)
  results.forEach((rows, i) => {
    const constraints = queries[i].$constraints

    Object.entries(constraints).forEach(([name, meta]) => {
      const col = `${name}_constraint`

      rows.forEach(row => {
        if (row[col]) return // constraint passed

        req.error(400, buildMessage(name, meta, row)) // raise validation error
      })
    })
  })

  constraintStorage.clear(this.tx) // clean up
}
module.exports = {
  attachConstraints,
  checkConstraints,
}
