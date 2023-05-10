const jest = module.exports = {
  testTimeout: 10000,
  collectCoverage: false,
  reporters: process.env.CI ? ['github-actions', 'summary'] : ['default'],
  testPathIgnorePatterns: []
}

const driver = process.env.DB ||
  process.argv.find(a => a.toLowerCase() === 'hana' || a.toLowerCase() === 'sqlite' || a.toLowerCase() === 'pg')

switch (driver) {
  // Run all unit tests that don't use the database
  case 'none':
    jest.testMatch = [
      '/test/cqn4sql/',
      '/test/cqn2sql/',
      '/test/cds-infer/',
    ].map(f => `**${f}**.test.js`)
    break

  // Run all tests that work with postgres
  case 'pg':
    // eslint-disable-next-line no-case-declarations
    const credentials = {
      host: 'localhost',
      port: '5432',
      database: 'postgres',
      user: 'postgres',
      password: 'postgres'
    }
    process.env.CDS_CONFIG = JSON.stringify({
      requires: {
        db: {
          credentials,
          // When truthy will use sqlite compiler and rewrite all CREATE and DROP statements
          independentDeploy: false,
          dialect: 'postgres',
          impl: '@cap-js/sqlite/lib/db/pg/PostgresService.js'
        },
        cdsc: {
          dialect: 'postgres'
        }
      }
    })

    jest.testMatch = [
      '/test/pg/',
      '/test/compliance/',
      '/test/scenarios/**/'
    ].map(f => `**${f}**.test.js`)
    break
  
  // Run all tests that use the database
  case 'sqlite':
    process.env.CDS_CONFIG = JSON.stringify({
      requires: {
        db: {
           credentials: { url: ":memory:" },
           impl: "@cap-js/sqlite",
          kind: 'sqlite'
        }
      }
    })
    jest.testMatch = [
      '/test/',
      '/test/deep/',
      '/test/general/',
      '/test/unmanaged-assocs/',
      '/test/compliance/',
      '/test/scenarios/**/'
    ].map(f => `**${f}**.test.js`)
    break
 
  // Run all tests except for pg
  // default:
  //   process.env.CDS_CONFIG = JSON.stringify({
  //     requires: {
  //       db: {
  //          credentials: { url: ":memory:" },
  //          impl: "@cap-js/sqlite",
  //         kind: 'sqlite'
  //       }
  //     }
  //   })
  //   testPathIgnorePatterns.push('test/cds-pg-tests')
  //   testPathIgnorePatterns.push('test/pg')
  //   break
}
