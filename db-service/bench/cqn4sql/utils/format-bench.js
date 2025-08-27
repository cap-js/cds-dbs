'use strict'

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

function getCommitShort() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    const sha = process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA || ''
    return sha ? sha.slice(0, 7) : `unknown-${new Date().toISOString().replace(/[:.]/g, '-')}`
  }
}

function collectBenchmarksForFile(resultsPath, testFileBase) {
  const lines = fs.existsSync(resultsPath) ? fs.readFileSync(resultsPath, 'utf8').split(/\r?\n/).filter(Boolean) : []

  const benchmarks = {}
  for (const line of lines) {
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    const key = Object.keys(obj)[0]
    const data = obj[key]
    if (!data) continue

    const fromThisFile = data.file === testFileBase || (typeof key === 'string' && key.startsWith(`${testFileBase}:`))
    if (!fromThisFile) continue

    const title = data.title || key.split(':')[1] || key
    if (data.requests) benchmarks[title] = data.requests // keep only "requests"
  }
  return benchmarks
}

/**
 * Formats & writes the cumulative dump:
 *   dump[commit] = { date, benchmarks }
 *
 * @param {object} opts
 * @param {string} opts.testFile   absolute __filename of the calling test
 * @param {string} [opts.resultsFile='results.bench']
 * @param {string} [opts.dumpFile='perf-benchmarks.json']
 * @returns {false | {commit:string,file:string,count:number}}
 */
function writeDump({
  testFile,
  resultsFile = 'results.bench',
  dumpFile = 'cqn4sql-benchmarks.json',
  deleteResultsFile = true,
}) {
  const testFileBase = path.basename(testFile)
  const resultsPath = path.resolve(process.cwd(), resultsFile)
  const dumpPath = path.resolve(process.cwd() + '/results', dumpFile)

  const benchmarks = collectBenchmarksForFile(resultsPath, testFileBase)
  if (!Object.keys(benchmarks).length) return false

  const commit = getCommitShort()
  const entry = { date: new Date().toISOString(), benchmarks }

  let dump = {}
  if (fs.existsSync(dumpPath)) {
    try {
      dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8')) || {}
    } catch {
      dump = {}
    }
  }
  dump[commit] = entry

  fs.mkdirSync(path.dirname(dumpPath), { recursive: true })
  fs.writeFileSync(dumpPath, JSON.stringify(dump, null, 2) + '\n', 'utf8')

  if (deleteResultsFile && fs.existsSync(resultsPath)) {
    try {
      fs.unlinkSync(resultsPath)
    } catch {
      /* ignore */
    }
  }

  return { commit, file: dumpPath, count: Object.keys(benchmarks).length }
}

module.exports = { writeDump }
