'use strict'

const { getValidationQuery, buildMessage, getWhereOfPatch, getConstraintsByTarget } = require('./utils')

const constraintStorage = require('./storage')

/**
 *
 * Hook that gathers every `@assert.constraint` touched by the current
 * request, optionally augments them with an extra filter (the
 * `where` of an UPDATE/UPSERT), and merges the result into
 * {@link constraintStorage} so it can be validated once per transaction in
 * {@link checkConstraints}.
 *
 * 1.  Skip CSV/multipart inserts.
 * 2.  Call `getConstraintsByTarget()` to obtain a `Map`
 *     `targetName → ConstraintDict`.
 * 3.  If the root entity is an UPDATE/UPSERT, retrieve its filter via
 *     `getWhereOfPatch(req)` and push it into the `where` array of every
 *     constraint that belongs to that root entity.
 * 4.  For each target entity, merge the (possibly augmented) constraints into
 *     the per-transaction storage with `constraintStorage.merge(this.tx, …)`.
 *
 * Notes
 * ─────────────────────────────────────────────────────────────────
 * • No validation queries are built here; we only collect and store constraint metadata.
 * • The function is idempotent within the same transaction because
 *   `constraintStorage.merge` deduplicates constraints and WHEREs.
 *
 * @param {*}                        _res   (ignored)
 * @param {import('@sap/cds').Request} req   Current request being processed
 */

function attachConstraints(_res, req) {
  if (Array.isArray(req.data?.[0])) return // ignore CSV / multipart

  const byTarget = getConstraintsByTarget(req.target, req.data)
  if (!byTarget.size) return

  const patchWhere = getWhereOfPatch(req) // null | array
  const rootName = req.target.name

  for (const [targetName, constraints] of byTarget) {
    if (patchWhere && targetName === rootName) {
      Object.values(constraints).forEach(c => {
        c.where.push([{ xpr: patchWhere }])
      })
    }
    constraintStorage.merge(this.tx, targetName, constraints)
  }
}

/**
 *
 * Execute and evaluate all @assert-constraint validations that were
 * accumulated in `constraintStorage` for the current transaction.
 *
 * 1.  Fetch the bucket of constraints per target for `this.tx` → `Map<targetName, ConstraintDict>`
 * 2.  For every bucket build **one** SELECT statement via `getValidationQuery`
 *     (→ at most one query per entity, no matter how many CUD events occurred).
 * 3.  `this.run(queries)` – execute the statements in parallel.
 * 4.  Inspect every result set; if a row fails a constraint, raise
 *     `req.error(400, …)` with a translated / formatted message.
 * 5.  Always calls `constraintStorage.clear(this.tx)` at the end to free memory.
 *
 * @this   {import('@sap/cds').Service}  CAP service or transactional context
 * @param  {import('@sap/cds').Request}  req
 *         The root request that triggered the commit.  Used only to emit
 *         `req.error(...)` messages.
 *
 * @returns {Promise<void>}  Resolves when all validations are finished.
 *
 * @throws  {req.error(400)} One or more errors per violated constraint.
 *
 */
async function checkConstraints(req) {
  const constraintsPerEntity = constraintStorage.get(this.tx)
  if (!constraintsPerEntity.size) return

  // build exactly one query per entity
  const queries = []
  for (const [targetName, constraints] of constraintsPerEntity) {
    queries.push(getValidationQuery(targetName, constraints))
  }

  const results = await this.run(queries)

  results.forEach((rows, i) => {
    const constraints = queries[i].$constraints
    Object.entries(constraints).forEach(([name, meta]) => {
      const col = `${name}_constraint`
      rows.forEach(row => {
        if (row[col]) return
        req.error(400, buildMessage(name, meta, row))
      })
    })
  })

  constraintStorage.clear(this.tx)
}
module.exports = {
  attachConstraints,
  checkConstraints,
}
