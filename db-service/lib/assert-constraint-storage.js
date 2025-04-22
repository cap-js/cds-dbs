'use strict'

const CONSTRAINTS = new WeakMap()          // ↩︎ GC when tx is gone
module.exports = {
  add (tx, batch) {
    const list = CONSTRAINTS.get(tx) ?? []
    list.push(batch)
    CONSTRAINTS.set(tx, list)
  },
  get (tx)     { return CONSTRAINTS.get(tx) ?? [] },
  clear (tx)   { CONSTRAINTS.delete(tx) }
}
