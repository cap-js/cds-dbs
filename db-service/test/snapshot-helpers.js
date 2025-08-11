'use strict'

const { expect } = require('chai')

// deterministic deep key sort
function canon(v) {
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((o, k) => (o[k] = canon(v[k]), o), {})
  }
  return v
}

// use when you've already removed inline 'expected'
function expectSnapshot(actual, name) {
  // 'name' is optional; useful if we snapshot multiple sub-parts in one test
  return expect(canon(actual), name).to.matchSnapshot()
}

// transitional wrapper to minimize diff while migrating
function equalOrSnapshot(actual, expected, name) {
  if (expected !== undefined) {
    return expect(actual).to.deep.equal(expected) // old behavior for now
  }
  return expectSnapshot(actual, name)
}

module.exports = { expectSnapshot, equalOrSnapshot, canon }
