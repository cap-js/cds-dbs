#!/usr/bin/env node

const sqlite = require('better-sqlite3')
const path = require('path')

// Helper functions from SQLiteService
function toFloatArray(vector) {
  if (vector == null) return null
  if (vector instanceof Float32Array) return Array.from(vector)
  if (Buffer.isBuffer(vector)) return JSON.parse(vector.toString('utf8'))
  if (vector instanceof Uint8Array) return JSON.parse(Buffer.from(vector).toString('utf8'))
  if (typeof vector === 'string') return JSON.parse(vector)
  if (Array.isArray(vector)) return vector
  throw new Error(`Unsupported vector type: ${typeof vector}`)
}

function cosineSimilarity(a, b) {
  if (a == null || b == null) return null
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

function l2Distance(a, b) {
  if (a == null || b == null) return null
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

function l2Normalize(v) {
  if (v == null) return null
  let norm = 0
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i]
  if (norm === 0) return v
  norm = Math.sqrt(norm)
  for (let i = 0; i < v.length; i++) v[i] /= norm
  return v
}

// Setup database
const db = new sqlite(':memory:')
const deterministic = { deterministic: true }
db.function('COSINE_SIMILARITY', deterministic, (a, b) => cosineSimilarity(toFloatArray(a), toFloatArray(b)))
db.function('L2DISTANCE', deterministic, (a, b) => l2Distance(toFloatArray(a), toFloatArray(b)))
db.function('L2NORMALIZE', deterministic, v => v == null ? null : JSON.stringify(l2Normalize(toFloatArray(v))))

// Create a dummy table
db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)')
db.exec('INSERT INTO test (id) VALUES (1)')

function benchmark(name, query, iterations) {
  const stmt = db.prepare(query)

  // Warm-up
  for (let i = 0; i < 10; i++) stmt.get()

  const start = process.hrtime.bigint()
  for (let i = 0; i < iterations; i++) {
    stmt.get()
  }
  const end = process.hrtime.bigint()

  const totalMs = Number(end - start) / 1_000_000
  const avgMs = totalMs / iterations

  console.log(`  ${name.padEnd(40)} | ${iterations.toString().padStart(5)} runs | Total: ${totalMs.toFixed(2).padStart(9)}ms | Avg: ${avgMs.toFixed(4).padStart(8)}ms`)
  return { totalMs, avgMs, iterations }
}

console.log('\n╔════════════════════════════════════════════════════════════════════╗')
console.log('║        Vector Functions Performance Benchmark                      ║')
console.log('╚════════════════════════════════════════════════════════════════════╝\n')

// Test 1: COSINE_SIMILARITY with 3D vectors
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('TEST 1: COSINE_SIMILARITY with 3-dimensional vectors')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

const js1 = benchmark(
  'JavaScript (COSINE_SIMILARITY)',
  `SELECT COSINE_SIMILARITY('[0.5,0.3,0.2]', '[0.1,0.9,0.4]') as result FROM test`,
  5000
)

const sql1 = benchmark(
  'SQL (json_each + aggregates)',
  `SELECT (SELECT
    CASE
      WHEN SQRT(normA) * SQRT(normB) = 0 THEN 0
      ELSE dot / (SQRT(normA) * SQRT(normB))
    END
  FROM (
    SELECT
      SUM(a.value * b.value) as dot,
      SUM(a.value * a.value) as normA,
      SUM(b.value * b.value) as normB
    FROM json_each('[0.5,0.3,0.2]') a
    JOIN json_each('[0.1,0.9,0.4]') b ON a.key = b.key
  )) as result FROM test`,
  5000
)

const speedup1 = (js1.avgMs / sql1.avgMs).toFixed(2)
const faster1 = js1.avgMs < sql1.avgMs ? 'JavaScript' : 'SQL'
console.log(`\n  ➜ Winner: ${faster1} is ${Math.abs(speedup1)}x faster\n`)

// Test 2: L2DISTANCE with 3D vectors
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('TEST 2: L2DISTANCE with 3-dimensional vectors')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

const js2 = benchmark(
  'JavaScript (L2DISTANCE)',
  `SELECT L2DISTANCE('[1,2,3]', '[4,5,6]') as result FROM test`,
  5000
)

const sql2 = benchmark(
  'SQL (json_each + aggregates)',
  `SELECT (SELECT SQRT(SUM((a.value - b.value) * (a.value - b.value)))
   FROM json_each('[1,2,3]') a
   JOIN json_each('[4,5,6]') b ON a.key = b.key) as result FROM test`,
  5000
)

const speedup2 = (js2.avgMs / sql2.avgMs).toFixed(2)
const faster2 = js2.avgMs < sql2.avgMs ? 'JavaScript' : 'SQL'
console.log(`\n  ➜ Winner: ${faster2} is ${Math.abs(speedup2)}x faster\n`)

// Test 3: L2NORMALIZE with 3D vectors
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('TEST 3: L2NORMALIZE with 3-dimensional vectors')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

const js3 = benchmark(
  'JavaScript (L2NORMALIZE)',
  `SELECT L2NORMALIZE('[3,4,0]') as result FROM test`,
  5000
)

const sql3 = benchmark(
  'SQL (json_each + aggregates)',
  `SELECT (SELECT json_group_array(
    CASE
      WHEN (SELECT SQRT(SUM(value * value)) FROM json_each('[3,4,0]')) = 0 THEN value
      ELSE value / (SELECT SQRT(SUM(value * value)) FROM json_each('[3,4,0]'))
    END
  ) FROM json_each('[3,4,0]')) as result FROM test`,
  5000
)

const speedup3 = (js3.avgMs / sql3.avgMs).toFixed(2)
const faster3 = js3.avgMs < sql3.avgMs ? 'JavaScript' : 'SQL'
console.log(`\n  ➜ Winner: ${faster3} is ${Math.abs(speedup3)}x faster\n`)

// Test with larger vectors (10D)
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('TEST 4: COSINE_SIMILARITY with 10-dimensional vectors')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

const vec10a = '[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0]'
const vec10b = '[1.0,0.9,0.8,0.7,0.6,0.5,0.4,0.3,0.2,0.1]'

const js4 = benchmark(
  'JavaScript (COSINE_SIMILARITY)',
  `SELECT COSINE_SIMILARITY('${vec10a}', '${vec10b}') as result FROM test`,
  3000
)

const sql4 = benchmark(
  'SQL (json_each + aggregates)',
  `SELECT (SELECT
    CASE
      WHEN SQRT(normA) * SQRT(normB) = 0 THEN 0
      ELSE dot / (SQRT(normA) * SQRT(normB))
    END
  FROM (
    SELECT
      SUM(a.value * b.value) as dot,
      SUM(a.value * a.value) as normA,
      SUM(b.value * b.value) as normB
    FROM json_each('${vec10a}') a
    JOIN json_each('${vec10b}') b ON a.key = b.key
  )) as result FROM test`,
  3000
)

const speedup4 = (js4.avgMs / sql4.avgMs).toFixed(2)
const faster4 = js4.avgMs < sql4.avgMs ? 'JavaScript' : 'SQL'
console.log(`\n  ➜ Winner: ${faster4} is ${Math.abs(speedup4)}x faster\n`)

// Test with 100D vectors
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('TEST 5: COSINE_SIMILARITY with 100-dimensional vectors')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

const vec100a = '[' + Array.from({length: 100}, (_, i) => (i % 100) / 100).join(',') + ']'
const vec100b = '[' + Array.from({length: 100}, (_, i) => ((i + 50) % 100) / 100).join(',') + ']'

const js5 = benchmark(
  'JavaScript (COSINE_SIMILARITY)',
  `SELECT COSINE_SIMILARITY('${vec100a}', '${vec100b}') as result FROM test`,
  1000
)

const sql5 = benchmark(
  'SQL (json_each + aggregates)',
  `SELECT (SELECT
    CASE
      WHEN SQRT(normA) * SQRT(normB) = 0 THEN 0
      ELSE dot / (SQRT(normA) * SQRT(normB))
    END
  FROM (
    SELECT
      SUM(a.value * b.value) as dot,
      SUM(a.value * a.value) as normA,
      SUM(b.value * b.value) as normB
    FROM json_each('${vec100a}') a
    JOIN json_each('${vec100b}') b ON a.key = b.key
  )) as result FROM test`,
  1000
)

const speedup5 = (js5.avgMs / sql5.avgMs).toFixed(2)
const faster5 = js5.avgMs < sql5.avgMs ? 'JavaScript' : 'SQL'
console.log(`\n  ➜ Winner: ${faster5} is ${Math.abs(speedup5)}x faster\n`)

// Summary
console.log('\n╔════════════════════════════════════════════════════════════════════╗')
console.log('║                        SUMMARY                                     ║')
console.log('╚════════════════════════════════════════════════════════════════════╝\n')
console.log('  JavaScript Implementation:')
console.log('    • SQLite calls custom JS function')
console.log('    • Simple loops and Math operations')
console.log(`    • Average: ${((js1.avgMs + js2.avgMs + js3.avgMs + js4.avgMs + js5.avgMs) / 5).toFixed(4)}ms per operation\n`)
console.log('  SQL Implementation:')
console.log('    • Pure SQL with json_each() and aggregations')
console.log('    • Stays within SQLite engine')
console.log(`    • Average: ${((sql1.avgMs + sql2.avgMs + sql3.avgMs + sql4.avgMs + sql5.avgMs) / 5).toFixed(4)}ms per operation\n`)

const jsAvg = (js1.avgMs + js2.avgMs + js3.avgMs + js4.avgMs + js5.avgMs) / 5
const sqlAvg = (sql1.avgMs + sql2.avgMs + sql3.avgMs + sql4.avgMs + sql5.avgMs) / 5
const ratio = (jsAvg / sqlAvg).toFixed(2)

if (ratio < 1) {
  console.log(`  ✓ JavaScript is ${(1/ratio).toFixed(2)}x faster on average`)
  console.log(`  ✓ Recommendation: Keep JavaScript implementation`)
} else {
  console.log(`  ✓ SQL is ${ratio}x faster on average`)
  console.log(`  ✓ Recommendation: Keep SQL implementation`)
}
console.log('\n')

db.close()
