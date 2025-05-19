'use strict'

const { getValidationQuery, buildMessage, getWhereOfPatch, getConstraintsByTarget } = require('./utils')

const constraintStorage = require('./storage')

const cds = require('@sap/cds')

/**
 *
 * “Before-hook” that gathers every `@assert.constraint` touched by the current
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
 * • No validation queries are built here; we only stash **metadata**.
 * • The function is idempotent within the same transaction because
 *   `constraintStorage.merge` deduplicates constraints and WHEREs.
 *
 * @this {import('@sap/cds').Service}  CAP service or transaction object
 * @param {*}                        _res   (ignored — payload from previous hook)
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
 * Validate all pending constraints for the current transaction.
 *
 * 1. Collect constraints from `constraintStorage`.
 * 2. Build **one** SQL query per target and run them in the current tx.
 * 3. For each failed row:
 *    - Lazily fetch the message params **only when** the constraint is violated.  
 *    - Build a message, and register it with `req.error(...)`,
 *      including all affected targets for the UI (`@Common.additionalTargets`).
 * 4. Clear the constraint cache for this transaction.
 *
 * @param {import('@sap/cds').Request} req – CDS request that will hold any validation errors.
 */
async function checkConstraints(req) {
  const constraintsPerTarget = constraintStorage.get(this.tx)
  if (!constraintsPerTarget.size) return

  // build exactly one query per bucket
  const queries = []
  for (const [targetName, constraints] of constraintsPerTarget) {
    queries.push(getValidationQuery(targetName, constraints))
  }

  const results = await this.run(queries)

  // key = message text        value = array of targets (order preserved)
  // this way messages are deduplicated
  const messages = new Map()

  for (const [i, rows] of results.entries()) {
    const constraints = queries[i].$constraints
    const paramQuery = queries[i].$paramQuery
    let params

    for (const [name, meta] of Object.entries(constraints)) {
      const col = `${name}_constraint`

      // request params in separate query, because constraint has failed
      if (paramQuery && rows.some(r => r[col] === false)) {
        const db = cds.tx(this) // use the same transaction as the query (or it would re-trigger the handler endlessly)
        params = await db.run(paramQuery)
      }

      for (const [j, r] of rows.entries()) {
        if (r[col]) continue // row satisfied the constraint → no error

        const row = params ? { ...r, ...params[j] } : r // merge only if needed

        const text = buildMessage(name, meta, row)
        const targets = meta.targets?.length ? meta.targets : [{ ref: [meta.element.name] }]

        ;(messages.get(text) ?? []).push(...targets)
        messages.set(text, targets)
      }
    }
  }

  for (const [text, targetList] of messages) {
    req.error(400, {
      message: text,
      target: targetList[0]?.ref.join('/'),
      '@Common.additionalTargets': targetList.map(t => t.ref.join('/')),
    })
  }

  constraintStorage.clear(this.tx)
}

module.exports = {
  attachConstraints,
  checkConstraints,
}
