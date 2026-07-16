#!/usr/bin/env node

// Simple standalone benchmark runner
const cds = require('@sap/cds')

async function benchmark(name, fn, iterations) {
  // Warm-up
  for (let i = 0; i < 10; i++) await fn()

  const start = process.hrtime.bigint()
  for (let i = 0; i < iterations; i++) {
    await fn()
  }
  const end = process.hrtime.bigint()
  const totalMs = Number(end - start) / 1_000_000
  const avgMs = totalMs / iterations

  console.log(`  ${name.padEnd(40)} | ${iterations.toString().padStart(5)} runs | Total: ${totalMs.toFixed(2).padStart(9)}ms | Avg: ${avgMs.toFixed(4).padStart(8)}ms`)
  return { totalMs, avgMs, iterations }
}

async function main() {
  // Connect to test database
  await cds.test(__dirname + '/../../test/compliance/resources')

  console.log('\n╔════════════════════════════════════════════════════════════════════╗')
  console.log('║        Vector Functions Performance Benchmark                      ║')
  console.log('╚════════════════════════════════════════════════════════════════════╝\n')

  // Test 1: COSINE_SIMILARITY with 3D vectors
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('TEST 1: COSINE_SIMILARITY with 3-dimensional vectors (2000 iterations)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const js1 = await benchmark(
    'JavaScript (cosine_similarity)',
    async () => {
      await SELECT.from('complex.associations.Books')
        .columns`cosine_similarity(cast('[0.5,0.3,0.2]' as cds.Vector), cast('[0.1,0.9,0.4]' as cds.Vector)) as result`
    },
    2000
  )

  const sql1 = await benchmark(
    'SQL (cosine_similarity_sql)',
    async () => {
      await SELECT.from('complex.associations.Books')
        .columns`cosine_similarity_sql(cast('[0.5,0.3,0.2]' as cds.Vector), cast('[0.1,0.9,0.4]' as cds.Vector)) as result`
    },
    2000
  )

  const speedup1 = (js1.avgMs / sql1.avgMs).toFixed(2)
  const faster1 = js1.avgMs < sql1.avgMs ? 'JavaScript' : 'SQL'
  console.log(`\n  ➜ Winner: ${faster1} is ${Math.abs(speedup1)}x ${faster1 === 'JavaScript' ? 'faster' : 'slower'}\n`)

  // Test 2: COSINE_SIMILARITY with 10D vectors
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('TEST 2: COSINE_SIMILARITY with 10-dimensional vectors (1000 iterations)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const js2 = await benchmark(
    'JavaScript (cosine_similarity)',
    async () => {
      await SELECT.from('complex.associations.Books')
        .columns`cosine_similarity(cast('[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0]' as cds.Vector), cast('[1.0,0.9,0.8,0.7,0.6,0.5,0.4,0.3,0.2,0.1]' as cds.Vector)) as result`
    },
    1000
  )

  const sql2 = await benchmark(
    'SQL (cosine_similarity_sql)',
    async () => {
      await SELECT.from('complex.associations.Books')
        .columns`cosine_similarity_sql(cast('[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0]' as cds.Vector), cast('[1.0,0.9,0.8,0.7,0.6,0.5,0.4,0.3,0.2,0.1]' as cds.Vector)) as result`
    },
    1000
  )

  const speedup2 = (js2.avgMs / sql2.avgMs).toFixed(2)
  const faster2 = js2.avgMs < sql2.avgMs ? 'JavaScript' : 'SQL'
  console.log(`\n  ➜ Winner: ${faster2} is ${Math.abs(speedup2)}x ${faster2 === 'JavaScript' ? 'faster' : 'slower'}\n`)

  // Test 3: L2DISTANCE with 3D vectors
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('TEST 3: L2DISTANCE with 3-dimensional vectors (2000 iterations)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const js3 = await benchmark(
    'JavaScript (l2distance)',
    async () => {
      await SELECT.from('complex.associations.Books')
        .columns`l2distance(cast('[1,2,3]' as cds.Vector), cast('[4,5,6]' as cds.Vector)) as result`
    },
    2000
  )

  const sql3 = await benchmark(
    'SQL (l2distance_sql)',
    async () => {
      await SELECT.from('complex.associations.Books')
        .columns`l2distance_sql(cast('[1,2,3]' as cds.Vector), cast('[4,5,6]' as cds.Vector)) as result`
    },
    2000
  )

  const speedup3 = (js3.avgMs / sql3.avgMs).toFixed(2)
  const faster3 = js3.avgMs < sql3.avgMs ? 'JavaScript' : 'SQL'
  console.log(`\n  ➜ Winner: ${faster3} is ${Math.abs(speedup3)}x ${faster3 === 'JavaScript' ? 'faster' : 'slower'}\n`)

  // Test 4: L2NORMALIZE with 3D vectors
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('TEST 4: L2NORMALIZE with 3-dimensional vectors (2000 iterations)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const js4 = await benchmark(
    'JavaScript (l2normalize)',
    async () => {
      await SELECT.from('complex.associations.Books')
        .columns`l2normalize(cast('[3,4,0]' as cds.Vector)) as result`
    },
    2000
  )

  const sql4 = await benchmark(
    'SQL (l2normalize_sql)',
    async () => {
      await SELECT.from('complex.associations.Books')
        .columns`l2normalize_sql(cast('[3,4,0]' as cds.Vector)) as result`
    },
    2000
  )

  const speedup4 = (js4.avgMs / sql4.avgMs).toFixed(2)
  const faster4 = js4.avgMs < sql4.avgMs ? 'JavaScript' : 'SQL'
  console.log(`\n  ➜ Winner: ${faster4} is ${Math.abs(speedup4)}x ${faster4 === 'JavaScript' ? 'faster' : 'slower'}\n`)

  // Summary
  console.log('\n╔════════════════════════════════════════════════════════════════════╗')
  console.log('║                        SUMMARY                                     ║')
  console.log('╚════════════════════════════════════════════════════════════════════╝\n')
  console.log('  JavaScript Implementation:')
  console.log('    • Calls out from SQL engine to JavaScript')
  console.log('    • Uses simple loops and Math operations')
  console.log(`    • Average performance: ~${((js1.avgMs + js2.avgMs + js3.avgMs + js4.avgMs) / 4).toFixed(4)}ms per operation\n`)
  console.log('  SQL Implementation:')
  console.log('    • Pure SQL using json_each() and aggregations')
  console.log('    • Stays entirely within SQLite engine')
  console.log(`    • Average performance: ~${((sql1.avgMs + sql2.avgMs + sql3.avgMs + sql4.avgMs) / 4).toFixed(4)}ms per operation\n`)

  const avgRatio = ((js1.avgMs + js2.avgMs + js3.avgMs + js4.avgMs) / (sql1.avgMs + sql2.avgMs + sql3.avgMs + sql4.avgMs)).toFixed(2)
  if (avgRatio < 1) {
    console.log(`  ✓ JavaScript is ${(1/avgRatio).toFixed(2)}x faster on average`)
  } else {
    console.log(`  ✓ SQL is ${avgRatio}x faster on average`)
  }
  console.log('\n')

  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
