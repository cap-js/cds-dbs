'use strict'

const {
  getValidationQuery,
  buildMessage,
  constraintStorage,
  patchWhere,
  getConstraintsByTarget,
} = require('./utils')

function attachConstraints(_res, req) {
  // TODO: validate csv imports?
  if (Array.isArray(req.data[0])) return

  // for each entity involved in the request, collect their constraints
  const byTarget = getConstraintsByTarget(req.target, req.data)
  if (!byTarget.size) return

  const extraWhere = patchWhere(req)
  const queries = []

  for (const [target, constraints] of byTarget) {
    queries.push(getValidationQuery(target, constraints, extraWhere, req.target))
  }

  if (queries.length) constraintStorage.add(this.tx, queries)
}

/**
 * Validate the constraint‑check queries collected in the current transaction.
 *
 * – runs every query batch in order,
 * – raises `req.error(400, …)` for each violated constraint,
 * – resets the constraint storage for the current transaction.
 */
async function checkConstraints(req) {
  const pending = constraintStorage.get(this.tx)
  if (!pending?.length) return // nothing to validate

  for (const queryBatch of pending) {
    const results = await this.run(queryBatch)

    results.forEach((rows, idx) => {
      const constraints = queryBatch[idx].$constraints

      Object.entries(constraints).forEach(([name, meta]) => {
        const col = `${name}_constraint`

        rows.forEach(row => {
          if (row[col]) return // constraint passed

          req.error(400, buildMessage(name, meta, row)) // raise validation error
        })
      })
    })
  }

  constraintStorage.clear(this.tx) // clean up
}
module.exports = {
  attachConstraints,
  checkConstraints,
}
