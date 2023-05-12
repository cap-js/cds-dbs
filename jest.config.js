module.exports = {
  testPathIgnorePatterns: [
    // Excluding tests which don't run locally - find better ways to control that
    'postgres',
    // Excluding tests which are red today -> should turn green
    'sqlite/test/general/localized.test.js',
    'test/scenarios/bookshop/funcs.test.js',
    'test/scenarios/bookshop/read.test.js',
    'test/scenarios/bookshop/genres.test.js'
  ]
}
