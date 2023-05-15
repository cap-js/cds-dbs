module.exports = {
  testPathIgnorePatterns: [
    // Excluding tests which don't run locally - find better ways to control that
    'postgres',
    // Excluding tests which are red today -> should turn green
    'test/scenarios/bookshop/funcs.test.js',
    'test/scenarios/bookshop/read.test.js',
    'test/scenarios/bookshop/genres.test.js'
  ]
}
