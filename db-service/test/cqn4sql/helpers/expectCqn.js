'use strict'

const cds = require('@sap/cds')
const { expect } = cds.test

const normalize = q => JSON.parse(JSON.stringify(q))

/**
 * Custom expect function for comparing normalized CQN objects.
 * Automatically cleanses non-enumerable props from the CQN objects.
 *
 * Usage:
 *   expectCqn(actual).to.equal(expected)
 *   expectCqn(actual).not.to.equal(expected)
 */
function expectCqn(actual) {
  const a = normalize(actual)
  const chain = expect(a)
  return {
    to: {
      equal: expected => chain.deep.equal(normalize(expected)),
    },
    get not() {
      return {
        to: {
          equal: expected => chain.not.deep.equal(normalize(expected)),
        },
      }
    },
  }
}

module.exports.expectCqn = expectCqn
