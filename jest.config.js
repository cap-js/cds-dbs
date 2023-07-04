// Currently has to be disabled before starting application (only required for node-hdb)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

// arguments that can be used to remove disabled tests
// Mostly to allow all tests to run when using vscode jest plugin
const enableMap = {
  pg: 'postgres',
  postgres: 'postgres',
  hana: 'hana',
  test: '<rootDir>/test/', // Allow to explicitly run compliance tests
}
Object.keys(enableMap).forEach(k => (enableMap['-' + k] = enableMap[k]))

const enable = process.argv
  .map(s => {
    if (s.startsWith(__dirname)) {
      s = s.substring(__dirname.length).split('/')[1]
    }
    if (s in enableMap) return enableMap[s]
  })
  .filter(a => a)

module.exports = {
  testTimeout: 30 * 1000,
  reporters: process.env.CI ? ['github-actions', 'summary'] : ['default'],
  testPathIgnorePatterns: [
    // Exclude compliance tests without database context
    '<rootDir>/test/',
    // Excluding tests which don't run locally - find better ways to control that
    'postgres',
    'hana',
  ].filter(e => !enable.includes(e)),
}
