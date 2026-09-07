'use strict'

const cds = require('@sap/cds')

// shared across cqn4sql and infer to guard against stack overflow from user-controlled nesting depth
const MAX_RECURSION_DEPTH = 100

let recursionDepth = 0

function enterRecursion() {
  if (++recursionDepth > MAX_RECURSION_DEPTH) throw cds.error(400, `Query exceeds the maximum nesting depth of ${MAX_RECURSION_DEPTH}`)
}

function depthGuarded(fn) {
  return function (...args) {
    enterRecursion()
    try {
      return fn.apply(this, args)
    } finally {
      recursionDepth--
    }
  }
}

// entry points (infer / cqn4sql): outermost call resets the counter, so a thrown
// depth error can't leave it polluted for the next request
function guardEntry(fn) {
  return function (...args) {
    const outermost = recursionDepth === 0
    enterRecursion()
    try {
      return fn.apply(this, args)
    } finally {
      if (outermost) recursionDepth = 0
      else recursionDepth--
    }
  }
}

module.exports = { depthGuarded, guardEntry }
