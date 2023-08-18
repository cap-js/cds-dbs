exports.testTimeout = 30 * 1000

// Ignore inherited tests that encounter tuple errors
if (!process.env.CI) exports.testPathIgnorePatterns = [
  '<rootDir>/test/timezone.test.js',
  '<rootDir>/test/service.test.js',
  '<rootDir>/test/service-types.test.js',
  '<rootDir>/test/service-admin.test.js',
  '<rootDir>/test/odata-string-functions.test.js',
]
