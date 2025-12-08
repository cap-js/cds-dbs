'use strict'

// make sure the build plugin works

const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')
const cds = require('../../test/cds.js')

const workDir = path.join(__dirname, 'tiny-sample')
const genDir = path.join(workDir, 'gen')
const pgDest = path.join(genDir, 'pg')
const dbDest = path.join(pgDest, 'db')

// delete the generated folder after each test
afterEach(() => {
  if (fs.existsSync(genDir)) fs.rmSync(genDir, { recursive: true })
})

describe('cds build plugin', () => {
  const { expect } = cds.test
  test('should run pg build with explicit build task', () => {
    execSync('npx cds build --for postgres', { cwd: workDir })
    expect(fs.existsSync(path.join(dbDest, 'csn.json'))).to.be.true
  })

  test('should run pg build with production profile', () => {
    execSync('npx cds build --production', { cwd: workDir })
    expect(fs.existsSync(path.join(dbDest, 'csn.json'))).to.be.true
  })

  test('should retain assert_integrity setting', () => {
    execSync('npx cds build --production', { cwd: workDir })
    const packageJson = require(path.join(pgDest, 'package.json'))
    expect(packageJson.cds?.features?.assert_integrity).to.equal('db')
    const ddl = String(execSync('npx cds deploy --dry', { cwd: workDir }))
    expect(ddl).to.contain('REFERENCES')
  })

  test('should retain cdsc settings', () => {
    execSync('npx cds build --production', { cwd: workDir })
    const packageJson = JSON.parse(fs.readFileSync(path.join(pgDest, 'package.json'), 'utf8'))
    expect(packageJson.cds?.cdsc?.defaultStringLength).to.equal(1000)
    expect(packageJson.cds?.cdsc?.standardDatabaseFunctions).to.be.true
    // this is excluded from being copied over
    expect(packageJson.cds?.cdsc?.moduleLookupDirectories).to.be.undefined
  })
  
  test('should retain db settings', () => {
    execSync('npx cds build --production', { cwd: workDir })
    const packageJson = require(path.join(pgDest, 'package.json'))
    expect(packageJson.cds?.requires?.db?.kind).to.equal('postgres')
    expect(packageJson.cds?.requires?.db?.vcap?.label).to.be.false
    expect(packageJson.cds?.requires?.db?.vcap?.name).to.equal('postgres-external')
  })

  test('should add the build-time versions of \'@sap/cds\' and \'@cap-js/postgres\'', () => {
    execSync('npx cds build --production', { cwd: workDir })
    const packageJson = require(path.join(pgDest, 'package.json'))
    expect(packageJson.dependencies?.['@sap/cds']).to.equal(cds.version)
    const pgAdapterVersion = require(path.join(workDir, 'package.json')).version;
    expect(packageJson.dependencies?.['@cap-js/postgres']).to.equal(pgAdapterVersion)
  })
})
