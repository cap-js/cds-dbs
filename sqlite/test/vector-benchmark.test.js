const cds = require('../../test/cds.js')

describe('Vector Functions Performance Benchmark', () => {
  const { expect } = cds.test(__dirname + '/../../test/compliance/resources')

  // Helper to measure execution time
  async function benchmark(name, fn, iterations = 1000) {
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

  describe('COSINE_SIMILARITY Performance', () => {
    test('Small vectors (3D)', async () => {
      const iterations = 2000
      console.log(`\n  Testing COSINE_SIMILARITY with 3-dimensional vectors`)

      const jsResult = await benchmark(
        'JavaScript (cosine_similarity)',
        async () => {
          await SELECT.from('complex.associations.Books')
            .columns`cosine_similarity(cast('[0.5,0.3,0.2]' as cds.Vector), cast('[0.1,0.9,0.4]' as cds.Vector)) as result`
        },
        iterations
      )

      const sqlResult = await benchmark(
        'SQL (cosine_similarity_sql)',
        async () => {
          await SELECT.from('complex.associations.Books')
            .columns`cosine_similarity_sql(cast('[0.5,0.3,0.2]' as cds.Vector), cast('[0.1,0.9,0.4]' as cds.Vector)) as result`
        },
        iterations
      )

      const speedup = Math.abs(jsResult.avgMs / sqlResult.avgMs).toFixed(2)
      const faster = jsResult.avgMs < sqlResult.avgMs ? 'JS' : 'SQL'
      const diff = Math.abs(jsResult.avgMs - sqlResult.avgMs).toFixed(4)
      console.log(`  ➜ Winner: ${faster} is ${speedup}x faster (${diff}ms difference)\n`)

      expect(jsResult.avgMs).to.be.a('number')
      expect(sqlResult.avgMs).to.be.a('number')
    })

    test('Medium vectors (10D)', async () => {
      const iterations = 1000
      console.log(`\n  Testing COSINE_SIMILARITY with 10-dimensional vectors`)

      const jsResult = await benchmark(
        'JavaScript (cosine_similarity)',
        async () => {
          await SELECT.from('complex.associations.Books')
            .columns`cosine_similarity(cast('[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0]' as cds.Vector), cast('[1.0,0.9,0.8,0.7,0.6,0.5,0.4,0.3,0.2,0.1]' as cds.Vector)) as result`
        },
        iterations
      )

      const sqlResult = await benchmark(
        'SQL (cosine_similarity_sql)',
        async () => {
          await SELECT.from('complex.associations.Books')
            .columns`cosine_similarity_sql(cast('[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0]' as cds.Vector), cast('[1.0,0.9,0.8,0.7,0.6,0.5,0.4,0.3,0.2,0.1]' as cds.Vector)) as result`
        },
        iterations
      )

      const speedup = Math.abs(jsResult.avgMs / sqlResult.avgMs).toFixed(2)
      const faster = jsResult.avgMs < sqlResult.avgMs ? 'JS' : 'SQL'
      const diff = Math.abs(jsResult.avgMs - sqlResult.avgMs).toFixed(4)
      console.log(`  ➜ Winner: ${faster} is ${speedup}x faster (${diff}ms difference)\n`)

      expect(jsResult.avgMs).to.be.a('number')
      expect(sqlResult.avgMs).to.be.a('number')
    })
  })

  describe('L2DISTANCE Performance', () => {
    test('Small vectors (3D)', async () => {
      const iterations = 2000
      console.log(`\n  Testing L2DISTANCE with 3-dimensional vectors`)

      const jsResult = await benchmark(
        'JavaScript (l2distance)',
        async () => {
          await SELECT.from('complex.associations.Books')
            .columns`l2distance(cast('[1,2,3]' as cds.Vector), cast('[4,5,6]' as cds.Vector)) as result`
        },
        iterations
      )

      const sqlResult = await benchmark(
        'SQL (l2distance_sql)',
        async () => {
          await SELECT.from('complex.associations.Books')
            .columns`l2distance_sql(cast('[1,2,3]' as cds.Vector), cast('[4,5,6]' as cds.Vector)) as result`
        },
        iterations
      )

      const speedup = Math.abs(jsResult.avgMs / sqlResult.avgMs).toFixed(2)
      const faster = jsResult.avgMs < sqlResult.avgMs ? 'JS' : 'SQL'
      const diff = Math.abs(jsResult.avgMs - sqlResult.avgMs).toFixed(4)
      console.log(`  ➜ Winner: ${faster} is ${speedup}x faster (${diff}ms difference)\n`)

      expect(jsResult.avgMs).to.be.a('number')
      expect(sqlResult.avgMs).to.be.a('number')
    })

    test('Medium vectors (10D)', async () => {
      const iterations = 1000
      console.log(`\n  Testing L2DISTANCE with 10-dimensional vectors`)

      const jsResult = await benchmark(
        'JavaScript (l2distance)',
        async () => {
          await SELECT.from('complex.associations.Books')
            .columns`l2distance(cast('[0,1,2,3,4,5,6,7,8,9]' as cds.Vector), cast('[9,8,7,6,5,4,3,2,1,0]' as cds.Vector)) as result`
        },
        iterations
      )

      const sqlResult = await benchmark(
        'SQL (l2distance_sql)',
        async () => {
          await SELECT.from('complex.associations.Books')
            .columns`l2distance_sql(cast('[0,1,2,3,4,5,6,7,8,9]' as cds.Vector), cast('[9,8,7,6,5,4,3,2,1,0]' as cds.Vector)) as result`
        },
        iterations
      )

      const speedup = Math.abs(jsResult.avgMs / sqlResult.avgMs).toFixed(2)
      const faster = jsResult.avgMs < sqlResult.avgMs ? 'JS' : 'SQL'
      const diff = Math.abs(jsResult.avgMs - sqlResult.avgMs).toFixed(4)
      console.log(`  ➜ Winner: ${faster} is ${speedup}x faster (${diff}ms difference)\n`)

      expect(jsResult.avgMs).to.be.a('number')
      expect(sqlResult.avgMs).to.be.a('number')
    })
  })

  describe('L2NORMALIZE Performance', () => {
    test('Small vectors (3D)', async () => {
      const iterations = 2000
      console.log(`\n  Testing L2NORMALIZE with 3-dimensional vectors`)

      const jsResult = await benchmark(
        'JavaScript (l2normalize)',
        async () => {
          await SELECT.from('complex.associations.Books')
            .columns`l2normalize(cast('[3,4,0]' as cds.Vector)) as result`
        },
        iterations
      )

      const sqlResult = await benchmark(
        'SQL (l2normalize_sql)',
        async () => {
          await SELECT.from('complex.associations.Books')
            .columns`l2normalize_sql(cast('[3,4,0]' as cds.Vector)) as result`
        },
        iterations
      )

      const speedup = Math.abs(jsResult.avgMs / sqlResult.avgMs).toFixed(2)
      const faster = jsResult.avgMs < sqlResult.avgMs ? 'JS' : 'SQL'
      const diff = Math.abs(jsResult.avgMs - sqlResult.avgMs).toFixed(4)
      console.log(`  ➜ Winner: ${faster} is ${speedup}x faster (${diff}ms difference)\n`)

      expect(jsResult.avgMs).to.be.a('number')
      expect(sqlResult.avgMs).to.be.a('number')
    })

    test('Medium vectors (10D)', async () => {
      const iterations = 1000
      console.log(`\n  Testing L2NORMALIZE with 10-dimensional vectors`)

      const jsResult = await benchmark(
        'JavaScript (l2normalize)',
        async () => {
          await SELECT.from('complex.associations.Books')
            .columns`l2normalize(cast('[1,2,3,4,5,6,7,8,9,10]' as cds.Vector)) as result`
        },
        iterations
      )

      const sqlResult = await benchmark(
        'SQL (l2normalize_sql)',
        async () => {
          await SELECT.from('complex.associations.Books')
            .columns`l2normalize_sql(cast('[1,2,3,4,5,6,7,8,9,10]' as cds.Vector)) as result`
        },
        iterations
      )

      const speedup = Math.abs(jsResult.avgMs / sqlResult.avgMs).toFixed(2)
      const faster = jsResult.avgMs < sqlResult.avgMs ? 'JS' : 'SQL'
      const diff = Math.abs(jsResult.avgMs - sqlResult.avgMs).toFixed(4)
      console.log(`  ➜ Winner: ${faster} is ${speedup}x faster (${diff}ms difference)\n`)

      expect(jsResult.avgMs).to.be.a('number')
      expect(sqlResult.avgMs).to.be.a('number')
    })
  })

  describe('Summary', () => {
    test('Performance Overview', () => {
      console.log('\n')
      console.log('  ═══════════════════════════════════════════════════════════════════')
      console.log('  BENCHMARK SUMMARY')
      console.log('  ═══════════════════════════════════════════════════════════════════')
      console.log('  ')
      console.log('  JavaScript Implementation:')
      console.log('    ✓ Calls out from SQL to JavaScript')
      console.log('    ✓ Uses simple loops and math operations')
      console.log('    ✓ Fast for small vectors')
      console.log('  ')
      console.log('  SQL Implementation:')
      console.log('    ✓ Pure SQL using json_each() and aggregations')
      console.log('    ✓ Stays within SQLite engine')
      console.log('    ✓ May have overhead from JSON parsing and JOINs')
      console.log('  ')
      console.log('  Based on the results above, choose the implementation that')
      console.log('  performs better for your typical vector dimensions.')
      console.log('  ═══════════════════════════════════════════════════════════════════')
      console.log('\n')
      expect(true).to.be.true
    })
  })
})
