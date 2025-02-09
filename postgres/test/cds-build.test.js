'use strict'

// make sure the build plugin works

const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')
const cds = require('../../test/cds.js')

const workDir = path.join(__dirname, 'tiny-sample')
const genDir = path.join(workDir, 'gen')
const dbDest = path.join(genDir, 'pg/db')

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
})
