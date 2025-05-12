const { describe, before, after, it } = global
global.describe.each = global.it.each = require('./test-each')
global.beforeAll = before
global.afterAll = after
global.test = it
global.xtest = it.skip
global.xdescribe = describe.skip
