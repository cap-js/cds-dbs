const chai = require('chai')
const chaiJestSnapshot = require('chai-jest-snapshot')

chai.use(chaiJestSnapshot)

before(function () {
  chaiJestSnapshot.resetSnapshotRegistry()
})

beforeEach(function () {
  chaiJestSnapshot.configureUsingMochaContext(this)
})

// stable deep key sort
function canon(v) {
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((o,k) => (o[k] = canon(v[k]), o), {})
  }
  return v
}

function isCQN(x) {
  return x && typeof x === 'object' &&
    (Object.prototype.hasOwnProperty.call(x, 'SELECT') ||
     Object.prototype.hasOwnProperty.call(x, 'INSERT') ||
     Object.prototype.hasOwnProperty.call(x, 'UPDATE') ||
     Object.prototype.hasOwnProperty.call(x, 'DELETE'))
}

// Tell jest-snapshot how to print CQN
chaiJestSnapshot.addSerializer({
  test: isCQN,
  print: (val) => JSON.stringify(canon(val), null, 2)
})
