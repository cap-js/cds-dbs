const cds = require('../../test/cds.js')
const { spawnSync } = require('child_process')
const path = require('path')

describe('sql_simple_queries without ieee754compatible', () => {
  const { expect } = cds.test()

  test('-> Decimal is not returned as string', () => {
    const CDS_CONFIG = JSON.stringify({ features: { sql_simple_queries: 1, ieee754compatible: false } })
    const cdsTest = require.resolve('@cap-js/cds-test/bin/chest.js')
    const env = { ...process.env, CDS_CONFIG, SIMPLE_QUERIES_CHILD: '1' }
    delete env.NODE_TEST_CONTEXT // otherwise the child does not report as its own run
    const result = spawnSync(process.execPath, [cdsTest, path.join(__dirname, 'simple-queries-odata.test.js')], {
      cwd: path.resolve(__dirname, '..'),
      env,
      encoding: 'utf8',
    })
    expect(result.stdout + result.stderr).to.match(/1 passed/)
    expect(result.status).to.equal(0)
  })
})
