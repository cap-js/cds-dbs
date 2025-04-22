'use strict'

/**
 * constraint‑storage.js
 *
 * Tiny helper that keeps validation queries in RAM per
 * transaction.  Internally uses a `WeakMap`, so data is released
 * automatically when the transaction object is garbage‑collected.  
 *
 * Keys   → {cds.Transaction}  
 * Values → Array<cds.Query>
 */

const CONSTRAINTS = new WeakMap()
module.exports = {
  add (tx, batch) {
    const list = CONSTRAINTS.get(tx) ?? []
    list.push(batch)
    CONSTRAINTS.set(tx, list)
  },
  get (tx)     { return CONSTRAINTS.get(tx) ?? [] },
  clear (tx)   { CONSTRAINTS.delete(tx) }
}
