const pipeline = !!process.env.CI

// Add github-actions reporter in pipelines
if (pipeline) exports.reporters = [ 'default', 'github-actions' ]

// Ignore inherited tests that encounter tuple errors
if (!pipeline) exports.testPathIgnorePatterns = [
  '<rootDir>/postgres/test/timezone.test.js',
  '<rootDir>/postgres/test/service.test.js',
  '<rootDir>/postgres/test/service-types.test.js',
  '<rootDir>/postgres/test/service-admin.test.js',
  '<rootDir>/postgres/test/odata-string-functions.test.js',
]

// Fix debugging
exports.transform = {}
