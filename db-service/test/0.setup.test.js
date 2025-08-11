const chai = require('chai')
const chaiJestSnapshot = require('chai-jest-snapshot')

chai.use(chaiJestSnapshot)

before(function () {
  chaiJestSnapshot.resetSnapshotRegistry()
})

beforeEach(function () {
  // links snapshot names/locations to the current test
  chaiJestSnapshot.configureUsingMocha(this)
})
