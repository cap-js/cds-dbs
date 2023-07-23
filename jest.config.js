exports.testPathIgnorePatterns = [
  'test/scenarios/sflight/integration.test.js', // REVISIT: is that test being run anywhere?
  'postgres',
]

// REVISIT: What do these reporters give us?
// if (process.env.CI) exports.reporters = ['github-actions', 'summary']