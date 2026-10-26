'use strict'

module.exports = { createState, getCalculatedValue }

const cloneCqn = require('./clone')

function createState() {
  return { resolutions: new WeakMap(), metadata: new WeakMap(), sourceAliases: new WeakMap() }
}

// Calculated expressions are scoped to their occurrence (implicit wildcard
// members use their definition). Inline rewriting carries the binding forward.
function getCalculatedValue(ctx, occurrence) {
  const element = occurrence.$refLinks?.at(-1).definition || occurrence
  if (!ctx.calculatedValues.has(occurrence)) ctx.calculatedValues.set(occurrence, cloneCqn(element.value))
  return ctx.calculatedValues.get(occurrence)
}
