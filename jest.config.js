module.exports = {
  reporters: process.env.CI ? ['github-actions', 'summary'] : ['default'],
  testPathIgnorePatterns: [
    // Exclude compliance tests without database context
    '<rootDir>/test/',
    // Excluding tests which don't run locally - find better ways to control that
    'postgres'
  ]
}
