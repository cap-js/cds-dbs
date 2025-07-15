'use strict'

const _constraintStorage = new WeakMap() // tx → Map<targetName, ConstraintDict>

function dedupWhere(arr) {
  const seen = new Set()
  return arr.filter(x => {
    const key = JSON.stringify(x) // keep track of expressions already seen
    return !seen.has(key) && seen.add(key)
  })
}

function mergeConstraint(a, b) {
  const merged = { ...a, ...b }

  const where = [...(a.where ?? []), ...(b.where ?? [])]
  merged.where = dedupWhere(where)

  return merged
}

/**
 * constraintStorage
 *
 * In-memory repository that collects assert-constraint metadata
 * _per CDS transaction_ and _per target entity_.
 * The data is stored in a `WeakMap`, so everything is garbage-collected
 * automatically when the transaction object becomes unreachable at the end of
 * the request.
 *
 * Storage structure
 * ─────────────────
 *   WeakMap
 *     └─ key   : cds.Transaction
 *     └─ value : Map<string, ConstraintDict>
 *                        └─ key   : target entity name (e.g. 'bookshop.Books')
 *                        └─ value : { [constraintName]: ConstraintMeta }
 *
 * `ConstraintMeta` is the object returned by `collectConstraints()` and may
 * contain `condition`, `parameters`, `where`, … – see utils.js.
 */
module.exports = {
  /**
   * Merge a set of constraints into the bucket that belongs to this tx+entity.
   * @param {import('@sap/cds').Transaction} tx
   * @param {string} targetName
   * @param {object} constraints   result of utils.getConstraintsByTarget().get(targetName)
   */
  merge(tx, targetName, constraints) {
    const txMap = _constraintStorage.get(tx) ?? new Map()
    const existingConstraintsForTarget = txMap.get(targetName) ?? {}

    for (const [name, c] of Object.entries(constraints)) {
      existingConstraintsForTarget[name] = existingConstraintsForTarget[name]
        ? mergeConstraint(existingConstraintsForTarget[name], c)
        : { ...c }
    }

    txMap.set(targetName, existingConstraintsForTarget)
    _constraintStorage.set(tx, txMap)
  },

  /** @returns Map<string,object> */
  get: tx => _constraintStorage.get(tx) ?? new Map(),
  clear: tx => _constraintStorage.delete(tx),
}
