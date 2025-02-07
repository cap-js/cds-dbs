'use strict'

// make sure the build plugin works

const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')
const { expect } = require('chai')

const workDir = path.join(__dirname, 'tiny-sample')
const genDir = path.join(workDir, 'gen')
const dbDest = path.join(genDir, 'pg/db')

// delete the generated folder after each test
afterEach(() => {
  if (fs.existsSync(genDir)) {
    fs.rmSync(genDir, { recursive: true })
  }
})

it('should run pg build with explicit build task', () => {
  execSync('cds build --for postgres', { cwd: workDir })
  expect(fs.existsSync(path.join(dbDest, 'csn.json'))).to.be.true
})

it('should run pg build with production profile', () => {
  execSync('cds build --production', { cwd: workDir })
  expect(fs.existsSync(path.join(dbDest, 'csn.json'))).to.be.true
})
