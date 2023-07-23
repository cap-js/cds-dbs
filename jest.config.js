module.exports = {
  reporters: process.env.CI ? ['github-actions', 'summary'] : ['default'],
  testPathIgnorePatterns: [
    'test/scenarios/sflight/integration.test.js', // REVISIT: is that test being run anywhere?
    'postgres',
  ]
}
