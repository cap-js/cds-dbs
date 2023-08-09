const pipeline = !!process.env.CI

exports.transform = {} // Fixes debugging

// Ignore inherited tests that encounter tuple errors
if (!pipeline)
  exports.testPathIgnorePatterns = [
    '<rootDir>/postgres/test/timezone.test.js',
    '<rootDir>/postgres/test/service.test.js',
    '<rootDir>/postgres/test/service-types.test.js',
    '<rootDir>/postgres/test/service-admin.test.js',
    '<rootDir>/postgres/test/odata-string-functions.test.js',
  ]
if (pipeline) exports.reporters = ['github-actions', 'summary']
