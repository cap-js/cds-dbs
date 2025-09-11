'use strict'

const { performance } = require('node:perf_hooks')
const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('node:child_process')

const cds = require('@sap/cds')
const cqn4sql = require('../lib/cqn4sql')

// config
const ITER = Number(process.env.ITER || 500)
const WARMUP = Number(process.env.WARMUP || 50)
const CSV_PATH = process.env.CSV || path.join(__dirname, 'results/results.csv')

// stats in ms
function stats(ms) {
  // sort values ascending for percentile/median calculation
  ms.sort((a, b) => a - b)

  const n = ms.length

  const min = ms[0]
  const max = ms[n - 1]
  const median = ms[Math.floor(n / 2)]
  const mean = ms.reduce((s, x) => s + x, 0) / n

  // 95th percentile --> 5% of runs were slower than p95
  const p95 = ms[Math.floor(n * 0.95)]
  // MAD (Median Absolute Deviation): measure of variability
  const madArr = ms.map(x => Math.abs(x - median)).sort((a, b) => a - b)
  const mad = madArr[Math.floor(n / 2)]

  return { n, min, max, median, p95, mean, mad }
}

function getCommitSha() {
  try {
    return execSync('git rev-parse --short=12 HEAD', { cwd: path.join(__dirname, '..') })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
}

function fmtNum(x) {
  return x.toFixed(3)
}

function appendCsvRow(filePath, commit, row) {
  const line =
    [
      commit,
      row.case,
      row.n,
      fmtNum(row.min),
      fmtNum(row.max),
      fmtNum(row.median),
      fmtNum(row.p95),
      fmtNum(row.mean),
      fmtNum(row.mad),
    ].join(',') + '\n'
  fs.appendFileSync(filePath, line, 'utf8')
}

function ensureCsvHeader(filePath) {
  const header = 'commit_sha,case,n,min_ms,max_ms,median_ms,p95_ms,mean_ms,mad_ms\n'
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, header, 'utf8')
  }
}

function removeExistingEntriesForCommit(filePath, commit) {
  if (!fs.existsSync(filePath)) return
  const prefix = commit + ','
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)

  const filtered = lines.filter((line, i) => i === 0 || !line.startsWith(prefix))

  fs.writeFileSync(filePath, filtered.join('\n'), 'utf8')
}

function gcSafe() {
  if (global.gc) global.gc()
}

;(async function run() {
  const modelDir = path.join(__dirname, 'model')
  const model = await cds.load([modelDir]).then(cds.linked)

  // discover cases
  const casesDir = path.join(__dirname, 'cases')
  const caseFiles = fs.readdirSync(casesDir).filter(f => /\.(cjs|js)$/.test(f))

  const commit = getCommitSha()
  // prepare CSV
  ensureCsvHeader(CSV_PATH)
  removeExistingEntriesForCommit(CSV_PATH, commit)

  const results = []

  for (const f of caseFiles) {
    const mod = require(path.join(casesDir, f))
    const label = mod.name || path.basename(f, path.extname(f))

    if (typeof mod.setup === 'function') await mod.setup({ cqn4sql, model, cds })

    // warmup
    for (let i = 0; i < WARMUP; i++) {
      const cqn = mod.buildInput({ model, cds })
      cqn4sql(cqn, model)
    }
    gcSafe()

    // timed iterations
    const times = []
    for (let i = 0; i < ITER; i++) {
      const cqn = mod.buildInput({ model, cds })
      const t0 = performance.now()
      cqn4sql(cqn, model)
      const t1 = performance.now()
      times.push(t1 - t0)
    }

    if (typeof mod.teardown === 'function') await mod.teardown()

    const s = stats(times)
    const row = { case: label, ...s }
    results.push({ commit, ...row })
    gcSafe()
  }

  results.sort((a, b) => a.median - b.median)

  console.log('case,n,min_ms,max_ms,median_ms,p95_ms,mean_ms,mad_ms')
  for (const row of results) {
    console.log(
      [
        row.case,
        row.n,
        fmtNum(row.min),
        fmtNum(row.max),
        fmtNum(row.median),
        fmtNum(row.p95),
        fmtNum(row.mean),
        fmtNum(row.mad),
      ].join(','),
    )
    appendCsvRow(CSV_PATH, commit, row)
  }

  console.error(`\nAppended results to ${CSV_PATH} (commit ${commit})`)
})().catch(err => {
  console.error(err)
  process.exit(1)
})
